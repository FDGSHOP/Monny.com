import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function clean(v: unknown) {
  return String(v ?? "").trim();
}

function resolveSupabaseSecret() {
  // Supabase รุ่นใหม่ inject SUPABASE_SECRET_KEYS เป็น JSON map
  // เช่น {"default":"sb_secret_..."}.
  // รองรับชื่อ key ที่ไม่ใช่ default และ legacy fallback ด้วย.
  try {
    const raw = (Deno.env.get("SUPABASE_SECRET_KEYS") ?? "").trim();
    if (raw) {
      const m = JSON.parse(raw);
      if (m && typeof m === "object") {
        if (typeof m.default === "string" && m.default.trim()) {
          return { key: m.default.trim(), source: "SUPABASE_SECRET_KEYS.default" };
        }
        for (const [name, value] of Object.entries(m)) {
          if (typeof value === "string" && value.trim()) {
            return { key: value.trim(), source: `SUPABASE_SECRET_KEYS.${name}` };
          }
        }
      }
    }
  } catch (err) {
    console.error("SUPABASE_SECRET_KEYS parse error:", err);
  }

  const singular = (Deno.env.get("SUPABASE_SECRET_KEY") ?? "").trim();
  if (singular) return { key: singular, source: "SUPABASE_SECRET_KEY" };

  const legacy = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  if (legacy) return { key: legacy, source: "SUPABASE_SERVICE_ROLE_KEY" };

  return { key: "", source: "" };
}


async function resolveStaffByAuth(admin: any, authUser: any) {
  let caller: any = null;
  let source = "";

  const { data: byId } = await admin
    .from("users")
    .select("id,username,display_name,role,status,deleted_at,status_reason")
    .eq("id", authUser.id)
    .maybeSingle();

  if (byId) {
    caller = byId;
    source = "auth_uuid";
  }

  if (!caller && authUser.email) {
    const email = String(authUser.email).trim().toLowerCase();
    const { data: rows } = await admin
      .from("users")
      .select("id,username,display_name,role,status,deleted_at,status_reason")
      .ilike("username", email)
      .limit(2);

    if (Array.isArray(rows) && rows.length === 1) {
      caller = rows[0];
      source = "username_email";
    }
  }

  return { caller, source };
}

async function findAuthUserId(admin: any, publicUser: any) {
  try {
    const { data, error } = await admin.auth.admin.getUserById(publicUser.id);
    if (!error && data?.user) return data.user.id;
  } catch (_) {}

  const email = String(publicUser.username ?? "").trim().toLowerCase();
  if (!email) return "";

  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) break;
    const users = data?.users ?? [];
    const found = users.find((u: any) => String(u.email ?? "").trim().toLowerCase() === email);
    if (found) return found.id;
    if (users.length < 100) break;
  }
  return "";
}

function partyName(p: any) {
  return clean(p?.account?.name?.th || p?.account?.name?.en || "");
}
function partyBank(p: any) {
  return clean(p?.bank?.name || p?.bank?.short || "");
}

async function providerFail(
  admin: any,
  kind: string,
  itemId: string,
  slipId: string | null,
  status: string,
  message: string,
  raw: any,
) {
  const rpc = kind === "RIDER_REMITTANCE"
    ? "fdg_fail_rider_remittance"
    : kind === "RIDER_CUSTOMER_SCAN"
      ? "fdg_fail_rider_scan_batch"
      : "fdg_fail_customer_scan_payment";

  const args = kind === "RIDER_REMITTANCE"
    ? {
        p_remittance_id: itemId,
        p_slip_verification_id: slipId,
        p_failure_status: status,
        p_reason: message,
        p_raw_response: raw ?? {},
      }
    : kind === "RIDER_CUSTOMER_SCAN"
      ? {
          p_batch_id: itemId,
          p_slip_verification_id: slipId,
          p_failure_status: status,
          p_reason: message,
          p_raw_response: raw ?? {},
        }
      : {
        p_payment_id: itemId,
        p_slip_verification_id: slipId,
        p_failure_status: status,
        p_reason: message,
        p_raw_response: raw ?? {},
      };

  const { error } = await admin.rpc(rpc, args);
  if (error) console.error("Failure RPC error:", error);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ status: "error", message: "Method not allowed" }, 405);

  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").trim();
  const secretInfo = resolveSupabaseSecret();
  const secret = secretInfo.key;

  if (!supabaseUrl || !secret) {
    const missing: string[] = [];
    if (!supabaseUrl) missing.push("SUPABASE_URL");
    if (!secret) missing.push("SUPABASE_SECRET_KEYS / SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY");
    return json({
      status: "error",
      code: "SERVER_CONFIG",
      message: `Edge Function ยังขาดการตั้งค่า: ${missing.join(", ")}`,
      missing,
    }, 500);
  }

  let body: any = {};
  try { body = await req.json(); } catch {
    return json({ status: "error", message: "ข้อมูลไม่ถูกต้อง" }, 400);
  }
  const kind = clean(body.type).toUpperCase();

  const admin = createClient(supabaseUrl, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ==========================================================
  // LOGIN RECOVERY V3 — AUTH FIRST + LEGACY PROFILE LINK
  //
  // Correct password is checked against Supabase Auth FIRST.
  // After Auth succeeds, public.users is resolved by:
  //   1) public.users.id = auth.users.id
  //   2) fallback public.users.username = auth email
  //
  // This supports legacy Master/Admin profiles whose public UUID
  // was created before Auth UUID linking was introduced.
  // ==========================================================
  if (kind === "STAFF_LOGIN") {
    const email = clean(body.email).toLowerCase();
    const password = String(body.password ?? "");
    const publicKey = clean(req.headers.get("apikey"));

    if (!email || !password || !publicKey) {
      return json({
        status: "error",
        code: "LOGIN_FAILED",
        message: "Email หรือ Password ไม่ถูกต้อง",
      }, 400);
    }

    async function findPublicProfile(authId: string, authEmail: string) {
      const { data: byId } = await admin
        .from("users")
        .select("id,username,display_name,role,status,deleted_at,status_reason")
        .eq("id", authId)
        .maybeSingle();

      if (byId) return byId;

      const { data: byEmail } = await admin
        .from("users")
        .select("id,username,display_name,role,status,deleted_at,status_reason")
        .ilike("username", authEmail)
        .limit(2);

      if (Array.isArray(byEmail) && byEmail.length === 1) return byEmail[0];
      return null;
    }

    async function findAuthUserByEmail(targetEmail: string) {
      for (let page = 1; page <= 10; page++) {
        const { data, error } = await admin.auth.admin.listUsers({
          page,
          perPage: 100,
        });
        if (error) return null;

        const users = data?.users ?? [];
        const found = users.find(
          (u: any) => String(u.email ?? "").trim().toLowerCase() === targetEmail
        );
        if (found) return found;
        if (users.length < 100) break;
      }
      return null;
    }

    const authClient = createClient(supabaseUrl, publicKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1) Validate the real password first.
    const { data: loginData, error: loginErr } =
      await authClient.auth.signInWithPassword({ email, password });

    if (loginErr || !loginData?.session || !loginData?.user) {
      // Wrong password: resolve staff only to update the 3-strike counter.
      // This resolution does NOT decide whether the password is correct.
      const authRecord = await findAuthUserByEmail(email);
      const profile = authRecord
        ? await findPublicProfile(authRecord.id, email)
        : null;

      // Keep unknown email and Master failure generic.
      if (
        !profile ||
        !["admin", "rider"].includes(String(profile.role))
      ) {
        return json({
          status: "error",
          code: "LOGIN_FAILED",
          message: "Email หรือ Password ไม่ถูกต้อง",
        }, 401);
      }

      const { data: currentSec } = await admin
        .from("staff_login_security")
        .select("failed_attempts,login_locked")
        .eq("user_id", profile.id)
        .maybeSingle();

      if (
        Boolean(currentSec?.login_locked) ||
        String(profile.status_reason ?? "") === "LOGIN_FAILURE_3"
      ) {
        return json({
          status: "error",
          code: "ACCOUNT_LOCKED",
          message: "บัญชีถูกล็อกเนื่องจาก Login ผิดครบ 3 ครั้ง กรุณาติดต่อ Master",
        }, 423);
      }

      const nextCount = Math.min(
        Number(currentSec?.failed_attempts ?? 0) + 1,
        3
      );
      const locked = nextCount >= 3;
      const nowIso = new Date().toISOString();

      const { error: securityErr } = await admin
        .from("staff_login_security")
        .upsert({
          user_id: profile.id,
          failed_attempts: nextCount,
          login_locked: locked,
          last_failed_at: nowIso,
          locked_at: locked ? nowIso : null,
          updated_at: nowIso,
        }, { onConflict: "user_id" });

      if (securityErr) {
        console.error("staff_login_security:", securityErr);
        return json({
          status: "error",
          code: "LOGIN_SECURITY_ERROR",
          message: "ระบบตรวจสอบการเข้าสู่ระบบมีปัญหา กรุณาติดต่อ Master",
        }, 500);
      }

      if (locked) {
        await admin
          .from("users")
          .update({
            status: "suspended",
            status_reason: "LOGIN_FAILURE_3",
            updated_at: nowIso,
          })
          .eq("id", profile.id);
      }

      return json({
        status: "error",
        code: locked ? "ACCOUNT_LOCKED" : "LOGIN_FAILED",
        message: locked
          ? "Login ผิดครบ 3 ครั้ง บัญชีถูกล็อก กรุณาติดต่อ Master"
          : "Email หรือ Password ไม่ถูกต้อง",
        failed_attempts: nextCount,
        remaining_attempts: Math.max(3 - nextCount, 0),
      }, locked ? 423 : 401);
    }

    // 2) Password is correct. Resolve the application profile AFTER Auth.
    const authUser = loginData.user;
    const profile = await findPublicProfile(
      authUser.id,
      String(authUser.email ?? email).trim().toLowerCase()
    );

    if (!profile) {
      return json({
        status: "error",
        code: "STAFF_PROFILE_NOT_LINKED",
        message: "รหัสผ่านถูกต้อง แต่ไม่พบโปรไฟล์พนักงานที่เชื่อมกับบัญชี Auth",
      }, 403);
    }

    if (!["master", "admin", "rider"].includes(String(profile.role))) {
      return json({
        status: "error",
        code: "STAFF_ROLE_INVALID",
        message: "บัญชีนี้ไม่มีสิทธิ์ใช้งานระบบพนักงาน",
      }, 403);
    }

    if (
      String(profile.status_reason ?? "") === "LOGIN_FAILURE_3"
    ) {
      return json({
        status: "error",
        code: "ACCOUNT_LOCKED",
        message: "บัญชีถูกล็อกเนื่องจาก Login ผิดครบ 3 ครั้ง กรุณาติดต่อ Master",
      }, 423);
    }

    if (profile.deleted_at || String(profile.status) !== "active") {
      return json({
        status: "error",
        code: "ACCOUNT_SUSPENDED",
        message: "บัญชีถูกระงับ กรุณาติดต่อ Master",
      }, 423);
    }

    // Correct password resets consecutive failures for Admin/Rider.
    if (["admin", "rider"].includes(String(profile.role))) {
      await admin
        .from("staff_login_security")
        .upsert({
          user_id: profile.id,
          failed_attempts: 0,
          login_locked: false,
          last_failed_at: null,
          locked_at: null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });
    }

    return json({
      status: "authenticated",
      access_token: loginData.session.access_token,
      refresh_token: loginData.session.refresh_token,
      expires_at: loginData.session.expires_at,
      user_id: authUser.id,
      public_user_id: profile.id,
      role: profile.role,
    });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json({ status: "error", message: "Unauthorized" }, 401);

  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  const authUser = userData?.user;
  if (userErr || !authUser) return json({ status: "error", message: "Session ไม่ถูกต้อง" }, 401);

  // ==========================================================
  // CHECKPOINT 4D — Master resets staff password / unlocks login
  // ==========================================================
  if (kind === "STAFF_RESET_PASSWORD") {
    const { caller, source } = await resolveStaffByAuth(admin, authUser);

    if (
      !caller ||
      String(caller.role) !== "master" ||
      String(caller.status) !== "active" ||
      caller.deleted_at
    ) {
      return json({ status: "error", message: "เฉพาะ Master Active เท่านั้นที่เปลี่ยนรหัสพนักงานได้" }, 403);
    }

    const userId = clean(body.user_id);
    const newPassword = String(body.new_password ?? "");
    if (!userId || newPassword.length < 8) {
      return json({ status: "error", message: "Password ใหม่ต้องอย่างน้อย 8 ตัวอักษร" }, 400);
    }

    const { data: target, error: targetErr } = await admin
      .from("users")
      .select("id,username,display_name,role,status,status_reason,deleted_at")
      .eq("id", userId)
      .maybeSingle();

    if (targetErr || !target || String(target.role) === "master") {
      return json({ status: "error", message: "ไม่พบบัญชีพนักงานที่เปลี่ยนรหัสได้" }, 404);
    }
    if (target.deleted_at) {
      return json({ status: "error", message: "บัญชีถูก Archive อยู่ กรุณากู้คืนก่อน" }, 409);
    }

    const authTargetId = await findAuthUserId(admin, target);
    if (!authTargetId) {
      return json({ status: "error", message: "ไม่พบบัญชี Auth ที่เชื่อมกับพนักงานรายนี้" }, 404);
    }

    const { error: updateErr } = await admin.auth.admin.updateUserById(authTargetId, {
      password: newPassword,
    });
    if (updateErr) {
      return json({ status: "error", message: "เปลี่ยนรหัสผ่านไม่สำเร็จ: " + updateErr.message }, 500);
    }

    const unlockBecauseLoginFailure = String(target.status_reason ?? "") === "LOGIN_FAILURE_3";

    await admin.from("staff_login_security").upsert({
      user_id: target.id,
      failed_attempts: 0,
      login_locked: false,
      locked_at: null,
      last_failed_at: null,
      unlocked_at: new Date().toISOString(),
      unlocked_by: caller.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

    if (unlockBecauseLoginFailure) {
      await admin.from("users")
        .update({
          status: "active",
          status_reason: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", target.id);
    }

    await admin.rpc("fdg_write_log", {
      p_action: "STAFF_PASSWORD_RESET",
      p_user_id: caller.id,
      p_role: "master",
      p_message: "Master เปลี่ยนรหัสผ่านพนักงาน",
      p_details: {
        target_user_id: target.id,
        target_role: target.role,
        unlocked_login_failure: unlockBecauseLoginFailure,
        master_resolved_by: source,
      },
      p_success: true,
    });

    return json({
      status: "password_reset",
      user_id: target.id,
      unlocked: unlockBecauseLoginFailure,
    });
  }

  // ==========================================================
  // CHECKPOINT 4 — Master creates Auth + public.users atomically
  // ==========================================================
  if (kind === "STAFF_CREATE") {
    // Resolve the logged-in Master robustly.
    // New staff rows use auth UUID as public.users.id, but an older Master
    // profile may have been created before that linkage existed.
    let caller: any = null;
    let callerSource = "";

    const { data: callerById, error: callerByIdErr } = await admin
      .from("users")
      .select("id,username,display_name,role,status,deleted_at")
      .eq("id", authUser.id)
      .maybeSingle();

    if (!callerByIdErr && callerById) {
      caller = callerById;
      callerSource = "auth_uuid";
    }

    if (!caller && authUser.email) {
      const email = String(authUser.email).trim().toLowerCase();
      const { data: callerByEmail, error: callerByEmailErr } = await admin
        .from("users")
        .select("id,username,display_name,role,status,deleted_at")
        .ilike("username", email)
        .limit(2);

      if (!callerByEmailErr && Array.isArray(callerByEmail) && callerByEmail.length === 1) {
        caller = callerByEmail[0];
        callerSource = "username_email";
      }
    }

    if (!caller) {
      return json({
        status: "error",
        code: "MASTER_PROFILE_NOT_LINKED",
        message: "ไม่พบโปรไฟล์ Master ที่เชื่อมกับบัญชี Login นี้ใน public.users",
      }, 403);
    }

    if (
      String(caller.role) !== "master" ||
      String(caller.status) !== "active" ||
      caller.deleted_at
    ) {
      return json({
        status: "error",
        code: "MASTER_NOT_ACTIVE",
        message: `บัญชี ${caller.display_name || caller.username || "Master"} ไม่ได้อยู่ในสถานะ Master Active`,
        diagnostics: {
          role: String(caller.role || ""),
          status: String(caller.status || ""),
          archived: Boolean(caller.deleted_at),
          resolved_by: callerSource,
        },
      }, 403);
    }

    const email = clean(body.email).toLowerCase();
    const password = String(body.password ?? "");
    const displayName = clean(body.display_name);
    const phone = clean(body.phone);
    const role = clean(body.role).toLowerCase();
    const bankName = clean(body.bank_name);
    const bankAccount = clean(body.bank_account_number);
    const address = clean(body.address);

    if (!email || !email.includes("@")) {
      return json({ status: "error", message: "Email ไม่ถูกต้อง" }, 400);
    }
    if (password.length < 8) {
      return json({ status: "error", message: "Password ต้องอย่างน้อย 8 ตัวอักษร" }, 400);
    }
    if (!displayName) {
      return json({ status: "error", message: "กรุณากรอกชื่อพนักงาน" }, 400);
    }
    if (!["admin","rider"].includes(role)) {
      return json({ status: "error", message: "Role ต้องเป็น admin หรือ rider" }, 400);
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: displayName,
        role,
      },
    });

    if (createErr || !created?.user) {
      return json({
        status: "error",
        message: createErr?.message || "สร้าง Supabase Auth ไม่สำเร็จ",
      }, 400);
    }

    const uid = created.user.id;
    const qrPrefix = role === "rider" ? "RID-" : "ADM-";
    const profile = {
      id: uid,
      username: email,
      display_name: displayName,
      role,
      qr_id: qrPrefix + uid.replaceAll("-", "").slice(0, 8).toUpperCase(),
      phone: phone || null,
      status: "active",
      base_salary: role === "admin" ? 9000 : 0,
      commission_rate: role === "rider" ? 0.07 : 0,
      required_work_days: 26,
      bank_name: bankName || null,
      bank_account_number: bankAccount || null,
      address: address || null,
    };

    const { error: profileErr } = await admin.from("users").insert(profile);

    if (profileErr) {
      // Roll back Auth if profile creation fails.
      try { await admin.auth.admin.deleteUser(uid); } catch (_) {}
      return json({
        status: "error",
        message: "สร้าง Auth ได้ แต่สร้าง Staff Profile ไม่สำเร็จ: " + profileErr.message,
      }, 500);
    }

    await admin.rpc("fdg_write_log", {
      p_action: "STAFF_ACCOUNT_CREATED",
      p_user_id: caller.id,
      p_role: "master",
      p_message: "Master สร้างบัญชีพนักงาน",
      p_details: {
        target_user_id: uid,
        email,
        display_name: displayName,
        role,
      },
      p_success: true,
    });

    return json({
      status: "created",
      user_id: uid,
      email,
      display_name: displayName,
      role,
      created_by_profile: caller.id,
      master_resolved_by: callerSource,
    });
  }

  const itemId = clean(body.id);
  if (!["RIDER_REMITTANCE", "RIDER_CUSTOMER_SCAN", "CUSTOMER_PAYMENT"].includes(kind) || !itemId) {
    return json({ status: "error", message: "type/id ไม่ถูกต้อง" }, 400);
  }

  const easySlipKey = (Deno.env.get("EASYSLIP_API_KEY") ?? "").trim();
  if (!easySlipKey) {
    return json({
      status: "error",
      code: "SERVER_CONFIG",
      message: "Edge Function ยังขาดการตั้งค่า: EASYSLIP_API_KEY",
    }, 500);
  }

  let expected = 0;
  let evidencePath = "";
  let code = "";
  let riderId: string | null = null;
  let customerId: string | null = null;
  let loanId: string | null = null;
  let paymentId: string | null = null;
  let remittanceId: string | null = null;
  let riderCollectionBatchId: string | null = null;

  if (kind === "RIDER_REMITTANCE") {
    const { data: rem, error } = await admin
      .from("rider_remittances")
      .select("*")
      .eq("id", itemId)
      .maybeSingle();

    if (error || !rem) return json({ status: "error", message: "ไม่พบรายการนำส่งเงิน" }, 404);
    if (rem.status === "verified") {
      return json({ status: "verified", message: "รายการนี้ตรวจสอบผ่านแล้ว", id: itemId });
    }
    if (!["pending", "verifying", "failed"].includes(String(rem.status))) {
      return json({ status: "error", message: `สถานะรายการไม่สามารถตรวจสอบได้: ${rem.status}` }, 409);
    }

    const { data: staff } = await admin.from("users").select("id,role,status").eq("id", authUser.id).maybeSingle();
    if (!staff || !["rider","admin","master"].includes(String(staff.role))) {
      return json({ status: "error", message: "บัญชีนี้ไม่มีสิทธิ์ตรวจสอบรายการ Rider" }, 403);
    }
    if (staff.role === "rider" && String(rem.rider_id) !== String(authUser.id)) {
      return json({ status: "error", message: "รายการนี้ไม่ใช่ของ Rider บัญชีนี้" }, 403);
    }

    expected = Number(rem.amount || 0);
    evidencePath = clean(rem.evidence_path);
    code = clean(rem.remittance_code) || itemId;
    riderId = rem.rider_id;
    remittanceId = rem.id;

    await admin.from("rider_remittances").update({ status: "verifying" }).eq("id", rem.id);
  } else if (kind === "RIDER_CUSTOMER_SCAN") {
    const { data: batch, error } = await admin
      .from("rider_collection_batches")
      .select("*")
      .eq("id", itemId)
      .maybeSingle();

    if (error || !batch) return json({ status: "error", message: "ไม่พบรายการ SCAN ของ Rider" }, 404);
    if (batch.status === "verified") {
      return json({ status: "verified", message: "รายการนี้ตรวจสอบผ่านแล้ว", id: itemId });
    }
    if (String(batch.payment_method) !== "SCAN") {
      return json({ status: "error", message: "รายการนี้ไม่ใช่ Rider Customer SCAN" }, 409);
    }
    if (!["pending", "verifying", "failed"].includes(String(batch.status))) {
      return json({ status: "error", message: `สถานะรายการไม่สามารถตรวจสอบได้: ${batch.status}` }, 409);
    }

    const { caller } = await resolveStaffByAuth(admin, authUser);
    if (!caller || caller.deleted_at || String(caller.status) !== "active" ||
        !["rider", "admin", "master"].includes(String(caller.role))) {
      return json({ status: "error", message: "บัญชีนี้ไม่มีสิทธิ์ตรวจสอบรายการ Rider" }, 403);
    }
    if (String(caller.role) === "rider" && String(batch.rider_id) !== String(caller.id)) {
      return json({ status: "error", message: "รายการนี้ไม่ใช่ของ Rider บัญชีนี้" }, 403);
    }

    expected = Number(batch.total_amount || 0);
    evidencePath = clean(batch.evidence_path);
    code = clean(batch.batch_code) || itemId;
    riderId = batch.rider_id;
    customerId = batch.customer_id;
    loanId = batch.loan_id;
    riderCollectionBatchId = batch.id;

  } else {
    const { data: pay, error } = await admin
      .from("loan_payments")
      .select("*")
      .eq("id", itemId)
      .maybeSingle();

    if (error || !pay) return json({ status: "error", message: "ไม่พบรายการชำระเงิน" }, 404);
    if (pay.status === "verified") {
      return json({ status: "verified", message: "รายการนี้ตรวจสอบผ่านแล้ว", id: itemId });
    }
    if (String(pay.payment_source) !== "CUSTOMER_SCAN") {
      return json({ status: "error", message: "รายการนี้ไม่ใช่ Customer SCAN" }, 409);
    }
    if (!["pending","verifying","failed"].includes(String(pay.status))) {
      return json({ status: "error", message: `สถานะรายการไม่สามารถตรวจสอบได้: ${pay.status}` }, 409);
    }

    const { data: customer } = await admin
      .from("customers")
      .select("id,auth_user_id")
      .eq("id", pay.customer_id)
      .maybeSingle();

    const { data: staff } = await admin.from("users").select("id,role").eq("id", authUser.id).maybeSingle();
    const isStaff = staff && ["admin","master"].includes(String(staff.role));
    if (!isStaff && String(customer?.auth_user_id) !== String(authUser.id)) {
      return json({ status: "error", message: "รายการนี้ไม่ใช่ของบัญชีลูกค้านี้" }, 403);
    }

    expected = Number(pay.cash_amount || 0);
    evidencePath = clean(pay.evidence_path);
    code = clean(pay.payment_code) || itemId;
    customerId = pay.customer_id;
    loanId = pay.loan_id;
    paymentId = pay.id;

    await admin.from("loan_payments").update({ status: "verifying" }).eq("id", pay.id);
  }

  if (!(expected > 0) || !evidencePath) {
    return json({ status: "error", message: "ยอดเงินหรือไฟล์สลิปไม่ครบ" }, 400);
  }

  if (kind === "RIDER_CUSTOMER_SCAN") {
    const { error } = await admin
      .from("rider_collection_batches")
      .update({ status: "verifying" })
      .eq("id", itemId)
      .in("status", ["pending", "verifying", "failed"]);
    if (error) return json({ status: "error", message: "ตั้งสถานะตรวจสอบ SCAN ไม่สำเร็จ" }, 500);
  }

  // Reuse current verification row for the same item when possible.
  let q = admin.from("slip_verifications").select("id").order("created_at", { ascending: false }).limit(1);
  q = kind === "RIDER_REMITTANCE"
    ? q.eq("rider_remittance_id", itemId)
    : kind === "RIDER_CUSTOMER_SCAN"
      ? q.eq("rider_collection_batch_id", itemId)
      : q.eq("loan_payment_id", itemId);

  const { data: oldRows } = await q;
  let slipId = oldRows?.[0]?.id ?? null;

  const baseSlip: any = {
    status: "verifying",
    job_id: code,
    expected_amount: expected,
    verification_type: kind,
    evidence_path: evidencePath,
    provider: "EASYSLIP",
    rider_id: riderId,
    customer_id: customerId,
    loan_id: loanId,
    loan_payment_id: paymentId,
    rider_remittance_id: remittanceId,
    rider_collection_batch_id: riderCollectionBatchId,
  };

  if (slipId) {
    const { error } = await admin.from("slip_verifications").update(baseSlip).eq("id", slipId);
    if (error) console.error("Verification update error:", error);
  } else {
    const { data: inserted, error } = await admin
      .from("slip_verifications")
      .insert(baseSlip)
      .select("id")
      .single();
    if (error || !inserted) {
      console.error("Verification insert error:", error);
      return json({ status: "error", message: "สร้างรายการตรวจสลิปไม่สำเร็จ" }, 500);
    }
    slipId = inserted.id;
  }

  const { data: blob, error: dlErr } = await admin.storage
    .from("payment-evidence")
    .download(evidencePath);

  if (dlErr || !blob) {
    await providerFail(admin, kind, itemId, slipId, "failed", "ไม่สามารถอ่านไฟล์สลิปได้", { storage_error: dlErr?.message });
    return json({ status: "failed", message: "ไม่สามารถอ่านไฟล์สลิปได้" }, 400);
  }

  const allowed = ["image/jpeg","image/png","image/gif","image/webp"];
  const mime = clean(blob.type).toLowerCase() || "image/jpeg";
  if (!allowed.includes(mime)) {
    await providerFail(admin, kind, itemId, slipId, "failed", "รองรับเฉพาะ JPEG, PNG, GIF และ WebP", { mime });
    return json({ status: "failed", message: "ชนิดไฟล์สลิปไม่รองรับ" }, 400);
  }
  if (blob.size > 4 * 1024 * 1024) {
    await providerFail(admin, kind, itemId, slipId, "failed", "ไฟล์สลิปต้องไม่เกิน 4 MB", { size: blob.size });
    return json({ status: "failed", message: "ไฟล์สลิปต้องไม่เกิน 4 MB" }, 400);
  }

  const form = new FormData();
  const fileName = evidencePath.split("/").pop() || "slip.jpg";
  form.append("image", new File([blob], fileName, { type: mime }));
  form.append("remark", code.slice(0, 255));
  form.append("matchAccount", "true");
  form.append("matchAmount", expected.toFixed(2));
  form.append("checkDuplicate", "true");

  let providerRaw: any = {};
  let providerResponse: Response;
  try {
    providerResponse = await fetch("https://api.easyslip.com/v2/verify/bank", {
      method: "POST",
      headers: { Authorization: `Bearer ${easySlipKey}` },
      body: form,
    });
    providerRaw = await providerResponse.json().catch(() => ({}));
  } catch (err) {
    await providerFail(admin, kind, itemId, slipId, "failed", "เชื่อมต่อ EasySlip ไม่สำเร็จ", { error: String(err) });
    return json({ status: "failed", message: "เชื่อมต่อ EasySlip ไม่สำเร็จ" }, 502);
  }

  if (!providerResponse.ok || providerRaw?.success !== true || !providerRaw?.data) {
    const msg = clean(providerRaw?.message) || `EasySlip HTTP ${providerResponse.status}`;
    await providerFail(admin, kind, itemId, slipId, "failed", msg, providerRaw);
    return json({ status: "failed", message: msg, provider_status: providerResponse.status }, 400);
  }

  const d = providerRaw.data;
  const rawSlip = d.rawSlip || {};
  const transRef = clean(rawSlip.transRef);
  const amountInSlip = Number(d.amountInSlip ?? rawSlip?.amount?.amount ?? 0);
  const duplicate = d.isDuplicate === true;
  const amountMatched = d.isAmountMatched === true;
  const accountMatched = d.matchedAccount != null;

  await admin.from("slip_verifications").update({
    transaction_reference: transRef || null,
    amount: amountInSlip || null,
    expected_amount: expected,
    sender_bank: partyBank(rawSlip.sender) || null,
    sender_name: partyName(rawSlip.sender) || null,
    receiver_bank: partyBank(rawSlip.receiver) || null,
    receiver_name: partyName(rawSlip.receiver) || null,
    is_duplicate: duplicate,
    is_amount_matched: amountMatched,
    is_account_matched: accountMatched,
    raw_response: providerRaw,
  }).eq("id", slipId);

  if (duplicate) {
    await providerFail(admin, kind, itemId, slipId, "duplicate", "สลิปนี้ถูกใช้หรือตรวจสอบไปแล้ว", providerRaw);
    return json({ status: "duplicate", message: "สลิปซ้ำ ไม่อนุมัติรายการ" }, 409);
  }
  if (!accountMatched) {
    await providerFail(admin, kind, itemId, slipId, "account_mismatch", "บัญชีผู้รับไม่ตรงกับบัญชีบริษัทที่ลงทะเบียนใน EasySlip", providerRaw);
    return json({ status: "account_mismatch", message: "บัญชีผู้รับไม่ตรงกับบัญชีบริษัท" }, 400);
  }
  if (!amountMatched || Math.abs(amountInSlip - expected) > 0.009) {
    await providerFail(admin, kind, itemId, slipId, "amount_mismatch", `ยอดในสลิปไม่ตรง ต้องเป็น ${expected.toFixed(2)} บาท`, providerRaw);
    return json({ status: "amount_mismatch", message: `ยอดสลิปต้องเป็น ${expected.toFixed(2)} บาท` }, 400);
  }
  if (!transRef) {
    await providerFail(admin, kind, itemId, slipId, "failed", "ไม่พบเลขอ้างอิงธุรกรรมในสลิป", providerRaw);
    return json({ status: "failed", message: "ไม่พบเลขอ้างอิงธุรกรรมในสลิป" }, 400);
  }

  const finalizeRpc = kind === "RIDER_REMITTANCE"
    ? "fdg_finalize_rider_remittance"
    : kind === "RIDER_CUSTOMER_SCAN"
      ? "fdg_finalize_rider_scan_batch"
      : "fdg_finalize_customer_scan_payment";

  const finalizeArgs = kind === "RIDER_REMITTANCE"
    ? {
        p_remittance_id: itemId,
        p_transaction_reference: transRef,
        p_actual_amount: amountInSlip,
        p_slip_verification_id: slipId,
      }
    : kind === "RIDER_CUSTOMER_SCAN"
      ? {
          p_batch_id: itemId,
          p_transaction_reference: transRef,
          p_actual_amount: amountInSlip,
          p_slip_verification_id: slipId,
        }
      : {
        p_payment_id: itemId,
        p_transaction_reference: transRef,
        p_actual_amount: amountInSlip,
        p_slip_verification_id: slipId,
      };

  const { data: finalized, error: finalErr } = await admin.rpc(finalizeRpc, finalizeArgs);

  if (finalErr) {
    const duplicateFinal = finalErr.message?.toLowerCase().includes("duplicate");
    await providerFail(
      admin, kind, itemId, slipId,
      duplicateFinal ? "duplicate" : "failed",
      duplicateFinal ? "เลขอ้างอิงสลิปนี้ถูกใช้งานแล้ว" : "ตัดยอดหลังตรวจสลิปไม่สำเร็จ",
      { provider: providerRaw, finalize_error: finalErr.message },
    );
    return json({
      status: duplicateFinal ? "duplicate" : "failed",
      message: duplicateFinal ? "สลิปซ้ำ ไม่อนุมัติรายการ" : "ตรวจสลิปผ่าน แต่บันทึกตัดยอดไม่สำเร็จ",
    }, 409);
  }

  return json({
    status: "verified",
    message: kind === "RIDER_REMITTANCE"
      ? "ตรวจสลิปผ่าน คืนเงินบริษัทเรียบร้อย"
      : kind === "RIDER_CUSTOMER_SCAN"
        ? "ตรวจสลิปผ่าน รับชำระหลายงวดเข้าบริษัทเรียบร้อย"
        : "ตรวจสลิปผ่าน ชำระเงินเรียบร้อย",
    transaction_reference: transRef,
    amount: amountInSlip,
    result: finalized,
  });
});
