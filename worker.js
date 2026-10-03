export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    function json(data, status = 200) {
      return new Response(JSON.stringify(data), {
        status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    }

    // ------------------------------------------------------------
    // AUTH HELPERS
    // ------------------------------------------------------------

    function base64UrlEncode(value) {
      return btoa(value)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
    }

    function base64UrlDecode(value) {
      const padded = value.replace(/-/g, '+').replace(/_/g, '/') +
        '='.repeat((4 - (value.length % 4)) % 4);
      return atob(padded);
    }

    async function hashPassword(password, salt) {
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' },
        key,
        256
      );
      return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    async function createJWT(payload, secret) {
      const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const body = base64UrlEncode(JSON.stringify({
        ...payload,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7
      }));
      const data = `${header}.${body}`;
      const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
      );
      const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
      return `${data}.${base64UrlEncode(String.fromCharCode(...new Uint8Array(sig)))}`;
    }

    async function verifyJWT(token, secret) {
      try {
        if (!token || !secret) return false;
        const parts = token.split('.');
        if (parts.length !== 3) return false;

        const [encodedHeader, encodedPayload, encodedSignature] = parts;
        const header = JSON.parse(base64UrlDecode(encodedHeader));
        const payload = JSON.parse(base64UrlDecode(encodedPayload));

        if (header.alg !== 'HS256' || header.typ !== 'JWT') return false;
        if (!payload.exp || Number(payload.exp) < Math.floor(Date.now() / 1000)) return false;

        const key = await crypto.subtle.importKey(
          'raw', new TextEncoder().encode(secret),
          { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
        );
        const signature = Uint8Array.from(base64UrlDecode(encodedSignature), (c) => c.charCodeAt(0));
        return await crypto.subtle.verify(
          'HMAC', key, signature,
          new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
        );
      } catch (error) {
        console.log('JWT verification failed:', error.message);
        return false;
      }
    }

    async function isAuthorized(request) {
      const authHeader = request.headers.get('Authorization') || '';
      if (!authHeader.toLowerCase().startsWith('bearer ')) return false;
      const token = authHeader.slice(7).trim();
      if (!token) return false;

      // Backward compatibility for the current admin page.
      if (env.ADMIN_TOKEN && token === env.ADMIN_TOKEN) return true;

      return await verifyJWT(token, env.ADMIN_JWT_SECRET);
    }

    function normalizePhone(phone) {
      return String(phone || '').replace(/[^\d]/g, '');
    }

    const TEMPLATE_MAP = {
      loan_applications: {
        'Under Review': 'loan_under_review',
        'Approved': 'loan_approved',
        'Rejected': 'loan_rejected',
        'Disbursed': 'loan_disbursed',
      },

      partnership_applications: {
        'Under Review': 'partnership_review',
        'Approved': 'partnership_approved',
        'Rejected': 'partnership_rejected',
      },

      capital_applications: {
        'Under Review': 'capital_under_review',
        'Approved': 'capital_approved',
        'Rejected': 'capital_rejected',
      },
    };

    async function sendWhatsAppTemplate(phone, templateName, params) {
      if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
        console.log(
          'WhatsApp credentials not configured yet, skipping send.'
        );
        return { skipped: true };
      }

      const whatsappUrl =
        'https://graph.facebook.com/v20.0/' +
        env.WHATSAPP_PHONE_NUMBER_ID +
        '/messages';

      const body = {
        messaging_product: 'whatsapp',
        to: normalizePhone(phone),
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'en' },
          components: [
            {
              type: 'body',
              parameters: params.map((p) => ({
                type: 'text',
                text: String(p),
              })),
            },
          ],
        },
      };

      const res = await fetch(whatsappUrl, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + env.WHATSAPP_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const result = await res.json();

      if (!res.ok) {
        console.log(
          'WhatsApp send failed:',
          JSON.stringify(result)
        );
      }

      return result;
    }

    try {
      /*
       * ============================================================
       * ADMIN: LOGIN
       * ============================================================
       */

      if (url.pathname === '/api/admin/login' && request.method === 'POST') {
        const data = await request.json();
        const password = String(data.password || '');

        if (!env.ADMIN_PASSWORD_HASH || !env.ADMIN_PASSWORD_SALT || !env.ADMIN_JWT_SECRET) {
          return json({ error: 'Admin authentication is not configured on the Worker.' }, 500);
        }

        if (!password) {
          return json({ error: 'Password is required.' }, 400);
        }

        const suppliedHash = await hashPassword(password, env.ADMIN_PASSWORD_SALT);
        if (suppliedHash !== env.ADMIN_PASSWORD_HASH) {
          return json({ error: 'Invalid password.' }, 401);
        }

        const token = await createJWT(
          { sub: 'admin', role: 'administrator' },
          env.ADMIN_JWT_SECRET
        );

        return json({ success: true, token, expiresIn: 604800 });
      }

      /*
       * ============================================================
      * APPLICATION TABLES
       * ============================================================
       */

      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS loan_applications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at TEXT NOT NULL,
          name TEXT,
          phone TEXT,
          email TEXT,
          dob TEXT,
          residence TEXT,
          amount REAL,
          term TEXT,
          purpose TEXT,
          income REAL,
          employment TEXT,
          surety_name TEXT,
          surety_phone TEXT,
          surety_address TEXT,
          surety_relation TEXT,
          collateral TEXT,
          status TEXT DEFAULT 'New'
        )
      `).run();

      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS partnership_applications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at TEXT NOT NULL,
          name TEXT,
          phone TEXT,
          email TEXT,
          dob TEXT,
          residence TEXT,
          occupation TEXT,
          shares INTEGER,
          total_contribution REAL,
          payout TEXT,
          payment_method TEXT,
          reason TEXT,
          next_of_kin TEXT,
          status TEXT DEFAULT 'New'
        )
      `).run();

      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS capital_applications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at TEXT,
          name TEXT,
          phone TEXT,
          email TEXT,

          business_name TEXT,
          business_stage TEXT,
          sector TEXT,
          location TEXT,

          business_description TEXT,
          problem_solved TEXT,
          target_customers TEXT,
          business_model TEXT,

          years_operating TEXT,
          monthly_revenue REAL DEFAULT 0,
          monthly_expenses REAL DEFAULT 0,

          capital_requested REAL DEFAULT 0,
          equity_offered TEXT,
          capital_use TEXT,

          assets TEXT,
          team TEXT,
          competition TEXT,
          traction TEXT,
          website TEXT,

          registration_status TEXT,
          investment_reason TEXT,
          additional_info TEXT,

          status TEXT DEFAULT 'New'
        )
      `).run();

      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS job_applications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at TEXT NOT NULL,
          full_name TEXT,
          date_of_birth TEXT,
          gender TEXT,
          nationality TEXT,
          phone TEXT,
          whatsapp TEXT,
          email TEXT,
          city TEXT,
          region TEXT,
          address TEXT,
          highest_qualification TEXT,
          field_of_study TEXT,
          institution TEXT,
          graduation_year TEXT,
          certifications TEXT,
          languages TEXT,
          digital_skills TEXT,
          employment_status TEXT,
          experience_level TEXT,
          years_experience TEXT,
          current_job TEXT,
          current_employer TEXT,
          experience_summary TEXT,
          preferred_role TEXT,
          job_category TEXT,
          preferred_location TEXT,
          work_mode TEXT,
          availability TEXT,
          salary_expectation REAL DEFAULT 0,
          skills TEXT,
          cv_link TEXT,
          reference TEXT,
          status TEXT DEFAULT 'New'
        )
      `).run();

      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS travel_applications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at TEXT NOT NULL,
          name TEXT,
          phone TEXT,
          email TEXT,
          origin TEXT,
          destination TEXT,
          travel_type TEXT,
          departure_date TEXT,
          details TEXT,
          status TEXT DEFAULT 'New'
        )
      `).run();

      /*
       * ============================================================
       * PUBLIC: CAPITAL / INVESTMENT APPLICATION
       * ============================================================
       */

      if (
        url.pathname === '/api/capital' &&
        request.method === 'POST'
      ) {
        const data = await request.json();

        await env.DB.prepare(`
          INSERT INTO capital_applications (
            created_at,
            name,
            phone,
            email,
            business_name,
            business_stage,
            sector,
            location,
            business_description,
            problem_solved,
            target_customers,
            business_model,
            years_operating,
            monthly_revenue,
            monthly_expenses,
            capital_requested,
            equity_offered,
            capital_use,
            assets,
            team,
            competition,
            traction,
            website,
            registration_status,
            investment_reason,
            additional_info,
            status
          )
          VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, ?, 'New'
          )
        `).bind(
          new Date().toISOString(),

          data.name || '',
          data.phone || '',
          data.email || '',

          data.businessName || '',
          data.businessStage || '',
          data.sector || '',
          data.location || '',

          data.businessDescription || '',
          data.problemSolved || '',
          data.targetCustomers || '',
          data.businessModel || '',

          data.yearsOperating || '',
          Number(data.monthlyRevenue || 0),
          Number(data.monthlyExpenses || 0),

          Number(data.capitalRequested || 0),
          data.equityOffered || '',
          data.capitalUse || '',

          data.assets || '',
          data.team || '',
          data.competition || '',
          data.traction || '',
          data.website || '',

          data.registrationStatus || '',
          data.investmentReason || '',
          data.additionalInfo || ''
        ).run();

        return json({
          success: true,
          message: 'Capital application received successfully',
        });
      }

      /*
       * ============================================================
       * PUBLIC: LOAN APPLICATION
       * ============================================================
       */

      if (
        url.pathname === '/api/apply' &&
        request.method === 'POST'
      ) {
        const data = await request.json();

        await env.DB.prepare(`
          INSERT INTO loan_applications (
            created_at,
            name,
            phone,
            email,
            dob,
            residence,
            amount,
            term,
            purpose,
            income,
            employment,
            surety_name,
            surety_phone,
            surety_address,
            surety_relation,
            collateral,
            status
          )
          VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, 'New'
          )
        `).bind(
          new Date().toISOString(),

          data.name || '',
          data.phone || '',
          data.email || '',
          data.dob || '',
          data.residence || '',

          Number(data.amount || 0),
          data.term || '',
          data.purpose || '',

          Number(data.income || 0),
          data.employment || '',

          data.suretyName || '',
          data.suretyPhone || '',
          data.suretyAddress || '',
          data.suretyRelation || '',

          data.collateral || ''
        ).run();

        return json({
          success: true,
          message: 'Loan application received successfully',
        });
      }

      /*
       * ============================================================
       * PUBLIC: PARTNERSHIP APPLICATION
       * ============================================================
       */

      if (
        url.pathname === '/api/partner' &&
        request.method === 'POST'
      ) {
        const data = await request.json();

        await env.DB.prepare(`
          INSERT INTO partnership_applications (
            created_at,
            name,
            phone,
            email,
            dob,
            residence,
            occupation,
            shares,
            total_contribution,
            payout,
            payment_method,
            reason,
            next_of_kin,
            status
          )
          VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'New'
          )
        `).bind(
          new Date().toISOString(),

          data.name || '',
          data.phone || '',
          data.email || '',
          data.dob || '',
          data.residence || '',
          data.occupation || '',

          Number(data.shares || 0),
          Number(data.totalContribution || 0),

          data.payout || '',
          data.paymentMethod || '',
          data.reason || '',
          data.nextOfKin || ''
        ).run();

        return json({
          success: true,
          message: 'Partnership application received successfully',
        });
      }

      /*
       * ============================================================
       * PUBLIC: JOB APPLICATION
       * ============================================================
       */

      if (
        url.pathname === '/api/jobs' &&
        request.method === 'POST'
      ) {
        const data = await request.json();

        await env.DB.prepare(`
          INSERT INTO job_applications (
            created_at, full_name, date_of_birth, gender, nationality,
            phone, whatsapp, email, city, region, address,
            highest_qualification, field_of_study, institution, graduation_year,
            certifications, languages, digital_skills, employment_status,
            experience_level, years_experience, current_job, current_employer,
            experience_summary, preferred_role, job_category, preferred_location,
            work_mode, availability, salary_expectation, skills, cv_link, reference,
            status
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'New'
          )
        `).bind(
          new Date().toISOString(),
          data.fullName || '',
          data.dateOfBirth || '',
          data.gender || '',
          data.nationality || '',
          data.phone || '',
          data.whatsapp || '',
          data.email || '',
          data.city || '',
          data.region || '',
          data.address || '',
          data.highestQualification || '',
          data.fieldOfStudy || '',
          data.institution || '',
          data.graduationYear || '',
          data.certifications || '',
          data.languages || '',
          data.digitalSkills || '',
          data.employmentStatus || '',
          data.experienceLevel || '',
          data.yearsExperience || '',
          data.currentJob || '',
          data.currentEmployer || '',
          data.experienceSummary || '',
          data.preferredRole || '',
          data.jobCategory || '',
          data.preferredLocation || '',
          data.workMode || '',
          data.availability || '',
          Number(data.salaryExpectation || 0),
          data.skills || '',
          data.cvLink || '',
          data.reference || ''
        ).run();

        return json({ success: true, message: 'Job application received successfully' });
      }

      /*
       * ============================================================
       * PUBLIC: TRAVEL ENQUIRY
       * ============================================================
       */

      if (
        url.pathname === '/api/travel' &&
        request.method === 'POST'
      ) {
        const data = await request.json();

        await env.DB.prepare(`
          INSERT INTO travel_applications (
            created_at, name, phone, email, origin, destination,
            travel_type, departure_date, details, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'New')
        `).bind(
          new Date().toISOString(),
          data.name || '',
          data.phone || '',
          data.email || '',
          data.origin || '',
          data.destination || '',
          data.travelType || '',
          data.departureDate || '',
          data.details || ''
        ).run();

        return json({ success: true, message: 'Travel enquiry received successfully' });
      }

      /*
       * ============================================================
       * ADMIN: LIST LOAN APPLICATIONS
       * ============================================================
       */

      if (
        url.pathname === '/api/admin/applications' &&
        request.method === 'GET'
      ) {
        if (!(await isAuthorized(request))) {
          return json(
            { error: 'Unauthorized' },
            401
          );
        }

        const { results } = await env.DB
          .prepare(
            'SELECT * FROM loan_applications ORDER BY id DESC'
          )
          .all();

        return json(results);
      }

      /*
       * ============================================================
       * ADMIN: LIST PARTNERSHIP APPLICATIONS
       * ============================================================
       */

      if (
        url.pathname === '/api/admin/partnerships' &&
        request.method === 'GET'
      ) {
        if (!(await isAuthorized(request))) {
          return json(
            { error: 'Unauthorized' },
            401
          );
        }

        const { results } = await env.DB
          .prepare(
            'SELECT * FROM partnership_applications ORDER BY id DESC'
          )
          .all();

        return json(results);
      }

      /*
       * ============================================================
       * ADMIN: LIST CAPITAL APPLICATIONS
       * ============================================================
       */

      if (
        url.pathname === '/api/admin/capital' &&
        request.method === 'GET'
      ) {
        if (!(await isAuthorized(request))) {
          return json(
            { error: 'Unauthorized' },
            401
          );
        }

        const { results } = await env.DB
          .prepare(
            'SELECT * FROM capital_applications ORDER BY id DESC'
          )
          .all();

        return json(results);
      }

      if (
        url.pathname === '/api/admin/jobs' &&
        request.method === 'GET'
      ) {
        if (!(await isAuthorized(request))) {
          return json({ error: 'Unauthorized' }, 401);
        }

        const { results } = await env.DB
          .prepare('SELECT * FROM job_applications ORDER BY id DESC')
          .all();

        return json(results);
      }

      if (
        url.pathname === '/api/admin/travel' &&
        request.method === 'GET'
      ) {
        if (!(await isAuthorized(request))) {
          return json({ error: 'Unauthorized' }, 401);
        }

        const { results } = await env.DB
          .prepare('SELECT * FROM travel_applications ORDER BY id DESC')
          .all();

        return json(results);
      }

      /*
       * ============================================================
       * ADMIN: UPDATE APPLICATION STATUS
       * ============================================================
       */

      if (
        url.pathname === '/api/admin/update-status' &&
        request.method === 'POST'
      ) {
        if (!(await isAuthorized(request))) {
          return json(
            { error: 'Unauthorized' },
            401
          );
        }

        const {
          table,
          id,
          status
        } = await request.json();

        const validTables = [
          'loan_applications',
          'partnership_applications',
          'capital_applications',
          'job_applications',
          'travel_applications',
        ];

        if (!validTables.includes(table)) {
          return json(
            { error: 'Invalid table' },
            400
          );
        }

        await env.DB.prepare(
          `UPDATE ${table} SET status = ? WHERE id = ?`
        )
          .bind(status, id)
          .run();

        /*
         * Send optional WhatsApp status update
         */

        const templateName =
          TEMPLATE_MAP[table] &&
          TEMPLATE_MAP[table][status];

        if (templateName) {
          const row = await env.DB
            .prepare(
              `SELECT * FROM ${table} WHERE id = ?`
            )
            .bind(id)
            .first();

          if (row && row.phone) {
            let params = [row.name];

            if (table === 'loan_applications') {
              params = [
                row.name,
                Number(row.amount || 0).toLocaleString()
              ];
            }

            if (table === 'capital_applications') {
              params = [
                row.name,
                row.business_name || 'your business',
                Number(
                  row.capital_requested || 0
                ).toLocaleString()
              ];
            }

            try {
              await sendWhatsAppTemplate(
                row.phone,
                templateName,
                params
              );
            } catch (e) {
              console.log(
                'WhatsApp send error:',
                e.message
              );
            }
          }
        }

        return json({
          success: true,
          message: 'Status updated successfully',
        });
      }

      /*
       * ============================================================
       * ADMIN: DELETE APPLICATIONS
       * ============================================================
       */

      if (
        url.pathname === '/api/admin/delete' &&
        request.method === 'POST'
      ) {
        if (!(await isAuthorized(request))) {
          return json(
            { error: 'Unauthorized' },
            401
          );
        }

        const {
          table,
          ids,
          all
        } = await request.json();

        const validTables = [
          'loan_applications',
          'partnership_applications',
          'capital_applications',
          'job_applications',
          'travel_applications',
        ];

        if (!validTables.includes(table)) {
          return json(
            { error: 'Invalid table' },
            400
          );
        }

        /*
         * Delete all
         */

        if (all) {
          await env.DB.prepare(
            `DELETE FROM ${table}`
          ).run();

          return json({
            success: true,
            message: 'All applications deleted',
          });
        }

        /*
         * Delete selected IDs
         */

        if (!Array.isArray(ids) || ids.length === 0) {
          return json(
            { error: 'No ids provided' },
            400
          );
        }

        const placeholders = ids
          .map(() => '?')
          .join(',');

        await env.DB.prepare(
          `DELETE FROM ${table}
           WHERE id IN (${placeholders})`
        )
          .bind(...ids)
          .run();

        return json({
          success: true,
          message: 'Selected applications deleted',
        });
      }

      /*
       * ============================================================
       * UNKNOWN ROUTE
       * ============================================================
       */

      return json(
        { error: 'Not found' },
        404
      );

    } catch (err) {
      console.error('Worker error:', err);

      return json(
        {
          error: err.message || 'Internal server error'
        },
        500
      );
    }
  },
};