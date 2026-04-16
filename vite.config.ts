/**
 * MBTQ.dev — vite.config.ts
 * ══════════════════════════════════════════════════════════════════════════════
 * Unified environment factory config for the full MBTQ distribution chain.
 *
 * Environments defined here:
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  NAME      RUNTIME          TIER      PURPOSE                          │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │  client    Browser          client    Deaf/HoH individual app          │
 * │  ssr       Node.js          builder   mbtq.dev platform shell          │
 * │  admin     Node.js          admin     Gov agency portal + reporting     │
 * │  vendor    Browser+WS       vendor    Specialist network + modules      │
 * │  edge      Cloudflare       builder   PinkSync accomodations stream     │
 * │  agents    Worker Thread    builder   360Magicians AI isolation         │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Reporting chain (admin env):
 *   VR agencies   → RSA-911 state + federal (RSA/ED)
 *   Workforce     → WIOA Title I/IV (ETA/DOLETA)
 *   SBA           → Program participation (SBA district + HQ)
 *
 * @requires vite ^6.0.0
 * @requires vite-environment-workerd (when Cloudflare target is active)
 */

import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import {
  createMBTQClientEnvironment,
  createMBTQSSREnvironment,
  createMBTQAdminEnvironment,
  createMBTQVendorEnvironment,
  createMBTQEdgeEnvironment,
  createMBTQAgentsEnvironment,
  type MBTQEnvContext,
  type MBTQAuditRecord,
  submitGovReport,
} from "./mbtq-environments";

// ─── AUDIT LOG SINK ───────────────────────────────────────────────────────────
// In production: replace with FibronRose SDK + Supabase insert
const auditQueue: MBTQAuditRecord[] = [];

const auditLog: MBTQEnvContext["auditLog"] = (record) => {
  const full: MBTQAuditRecord = {
    ...record,
    id: `mbtq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
  };
  auditQueue.push(full);
  if (process.env.NODE_ENV !== "production") {
    console.log(
      `[MBTQ AUDIT] ${full.tier} · ${full.stage} · ${full.action}`,
      full.moduleId
    );
  }
};

// ─── CONFIG ───────────────────────────────────────────────────────────────────
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "MBTQ_");

  /**
   * Admin / government context
   * Replace env vars with  actual agency endpoints.
   *
   * Required .env keys:
   *   MBTQ_VR_STATE_ENDPOINT        e.g. https://reporting.vr.ca.gov/api/rsa911
   *   MBTQ_VR_FEDERAL_ENDPOINT      e.g. https://rsa.ed.gov/api/submit
   *   MBTQ_WIOA_STATE_ENDPOINT      e.g. https://workforce.state.gov/wioa
   *   MBTQ_WIOA_FEDERAL_ENDPOINT    e.g. https://api.doleta.gov/wioa/submit
   *   MBTQ_SBA_STATE_ENDPOINT       e.g. https://sba.state.gov/8a/submit
   *   MBTQ_SBA_FEDERAL_ENDPOINT     e.g. https://api.sba.gov/program/submit
   *   MBTQ_PASETO_PUBKEY            PASETO v4 public key (base64)
   */
  const vrContext: MBTQEnvContext = {
    tier: "admin",
    programs: ["vocational_rehabilitation", "accommodation_services"],
    auditLog,
    reporting: {
      stateEndpoint:   env.MBTQ_VR_STATE_ENDPOINT   ?? "https://localhost:9001/vr/state",
      federalEndpoint: env.MBTQ_VR_FEDERAL_ENDPOINT ?? "https://localhost:9001/vr/federal",
      pasetoPublicKey: env.MBTQ_PASETO_PUBKEY        ?? "dev-key-replace-in-prod",
    },
  };

  const wioaContext: MBTQEnvContext = {
    tier: "admin",
    programs: ["workforce_innovation", "workforce_solutions"],
    auditLog,
    reporting: {
      stateEndpoint:   env.MBTQ_WIOA_STATE_ENDPOINT   ?? "https://localhost:9002/wioa/state",
      federalEndpoint: env.MBTQ_WIOA_FEDERAL_ENDPOINT ?? "https://localhost:9002/wioa/federal",
      pasetoPublicKey: env.MBTQ_PASETO_PUBKEY          ?? "dev-key-replace-in-prod",
    },
  };

  const sbaContext: MBTQEnvContext = {
    tier: "admin",
    programs: ["sba"],
    auditLog,
    reporting: {
      stateEndpoint:   env.MBTQ_SBA_STATE_ENDPOINT   ?? "https://localhost:9003/sba/state",
      federalEndpoint: env.MBTQ_SBA_FEDERAL_ENDPOINT ?? "https://localhost:9003/sba/federal",
      pasetoPublicKey: env.MBTQ_PASETO_PUBKEY         ?? "dev-key-replace-in-prod",
    },
  };

  const vendorContext: MBTQEnvContext = {
    tier: "vendor",
    programs: [
      "vocational_rehabilitation",
      "workforce_solutions",
      "sba",
      "accommodation_services",
    ],
    auditLog,
    // Vendor network doesn't submit directly to gov — funnels through admin
    // reporting intentionally omitted here
  };

  return {
    // ── PLUGINS ────────────────────────────────────────────────────────────
    plugins: [
      react(),
      tsconfigPaths(),

      // ── AUDIT FLUSH PLUGIN ──────────────────────────────────────────────
      // Flushes queued audit records to state + federal endpoints
      // when a full lifecycle stage completes in admin env
      {
        name: "mbtq-audit-flush",
        buildEnd: async () => {
          if (auditQueue.length === 0) return;
          if (mode !== "production") return;

          const vrRecords = auditQueue.filter((r) =>
            r.program === "vocational_rehabilitation"
          );
          const wioaRecords = auditQueue.filter((r) =>
            r.program === "workforce_innovation" ||
            r.program === "workforce_solutions"
          );
          const sbaRecords = auditQueue.filter((r) =>
            r.program === "sba"
          );

          const submissions = await Promise.allSettled([
            vrRecords.length > 0
              ? submitGovReport("vocational_rehabilitation", vrRecords, vrContext.reporting!)
              : Promise.resolve(null),
            wioaRecords.length > 0
              ? submitGovReport("workforce_innovation", wioaRecords, wioaContext.reporting!)
              : Promise.resolve(null),
            sbaRecords.length > 0
              ? submitGovReport("sba", sbaRecords, sbaContext.reporting!)
              : Promise.resolve(null),
          ]);

          submissions.forEach((result, i) => {
            const labels = ["VR/RSA-911", "WIOA/DOLETA", "SBA"];
            if (result.status === "fulfilled") {
              console.log(`[MBTQ REPORT] ${labels[i]} submitted successfully`);
            } else {
              console.error(`[MBTQ REPORT] ${labels[i]} submission failed:`, result.reason);
            }
          });
        },
      },

      // ── HOH VISUAL VALIDATION PLUGIN ────────────────────────────────────
      // Warns during dev if any component uses audio-first patterns
      // without a visual fallback (Deaf-first compliance check)
      {
        name: "mbtq-hoh-lint",
        transform(code: string, id: string) {
          if (!id.endsWith(".tsx") && !id.endsWith(".jsx")) return;

          const audioOnlyPatterns = [
            /new Audio\(/,
            /AudioContext\(/,
            /SpeechSynthesisUtterance\(/,
            /\.play\(\)/,
          ];

          const hasVisualFallback =
            code.includes("captionVisible") ||
            code.includes("hohMode") ||
            code.includes("__MBTQ_HOH_CAPABLE__") ||
            code.includes("flashVisual") ||
            code.includes("aslMode");

          for (const pattern of audioOnlyPatterns) {
            if (pattern.test(code) && !hasVisualFallback) {
              this.warn(
                `[MBTQ HOH] Audio-only pattern detected in ${id} without visual fallback. ` +
                `Add captionVisible, hohMode, or flashVisual for Deaf/HoH compliance.`
              );
            }
          }
        },
      },
    ],

    // ── ENVIRONMENTS ───────────────────────────────────────────────────────
    environments: {
      // 1. Browser — individual Deaf/HoH users
      client: createMBTQClientEnvironment(),

      // 2. SSR — mbtq.dev main platform
      ssr: createMBTQSSREnvironment({
        build: { outDir: "dist/ssr" },
      }),

      // 3. Admin — VR agencies (vocational rehabilitation)
      adminVR: createMBTQAdminEnvironment(vrContext, {
        build: { outDir: "dist/admin/vr" },
      }),

      // 4. Admin — Workforce (WIOA)
      adminWorkforce: createMBTQAdminEnvironment(wioaContext, {
        build: { outDir: "dist/admin/workforce" },
      }),

      // 5. Admin — SBA
      adminSBA: createMBTQAdminEnvironment(sbaContext, {
        build: { outDir: "dist/admin/sba" },
      }),

      // 6. Vendor network — specialists, coaches, VR counselors
      vendor: createMBTQVendorEnvironment(vendorContext, {
        build: { outDir: "dist/vendor" },
      }),

      // 7. Edge — PinkSync gateway (Cloudflare workerd)
      edge: createMBTQEdgeEnvironment({
        build: { outDir: "dist/edge" },
      }),

      // 8. Agents — 360Magicians Worker Thread isolation
      agents: createMBTQAgentsEnvironment({
        build: { outDir: "dist/agents" },
      }),
    },

    // ── SHARED BUILD ───────────────────────────────────────────────────────
    build: {
      // Each environment builds to its own outDir (defined above)
      // Root outDir is unused — just a fallback
      outDir: "dist",
    },

    // ── SERVER ─────────────────────────────────────────────────────────────
    server: {
      port: 4000,
      // configureServer is where you'd attach the VendorHotChannel WebSocket
      // Example in a Vite plugin:
      //   server.httpServer?.on('upgrade', (req, socket, head) => {
      //     if (req.url === '/vendor-hot') vendorWss.handleUpgrade(...)
      //   })
    },

    // ── RESOLVE ────────────────────────────────────────────────────────────
    resolve: {
      alias: {
        "@mbtq/client":  "/src/environments/client",
        "@mbtq/admin":   "/src/environments/admin",
        "@mbtq/vendor":  "/src/environments/vendor",
        "@mbtq/edge":    "/src/environments/edge",
        "@mbtq/agents":  "/src/environments/agents",
        "@mbtq/shared":  "/src/shared",
        "@mbtq/lifecycle": "/src/lifecycle",
        "@mbtq/reporting": "/src/reporting",
        "@mbtq/hoh":     "/src/accessibility/hoh",
        "@mbtq/deafauth": "/src/deafauth",
        "@mbtq/pinksync": "/src/pinksync",
        "@mbtq/fibronrose": "/src/fibronrose",
      },
    },

    // ── DEFINE (global constants across all envs) ──────────────────────────
    define: {
      __MBTQ_VERSION__:     JSON.stringify("2.0.0"),
      __MBTQ_DOMAIN__:      JSON.stringify("mbtq.dev"),
      __MBTQ_UNIVERSE__:    JSON.stringify("mbtquniverse.com"),
      __MBTQ_FIBONROSE__:   "true",
      __MBTQ_DEAFAUTH__:    "true",
      __MBTQ_PINKSYNC__:    "true",
      __MBTQ_DAO_ENABLED__: "true",
    },
  };
});

/**
 * ─── DISTRIBUTION CHAIN REFERENCE ───────────────────────────────────────────
 *
 * TIER 0: Pinky (builder/root)
 *   → Controls all environments, holds master keys
 *   → Deploys to Vercel (ssr), Cloudflare (edge), GitHub (source)
 *
 * TIER 1: Admin / Gov Agencies
 *   → adminVR        Vocational Rehabilitation agencies (state VR + RSA federal)
 *   → adminWorkforce Workforce boards (WIOA Title I/IV, ETA/DOLETA)
 *   → adminSBA       SBA district + headquarters
 *   → All on HTTP/HTTPS managed transport (no WebSocket)
 *   → All audit records → FibronRose → state + federal report endpoints
 *
 * TIER 2: Vendor Network
 *   → vendor         VR counselors, workforce coaches, SBA specialists
 *   → HotChannel WebSocket for real-time module sync across network
 *   → Module generators: lifecycle-sequential (idea → build → grow → managed)
 *   → Can submit proposals to admin for agency approval
 *   → White-label capable: vendors serve mbtq.dev integrated modules
 *
 * TIER 3: Clients / Individuals
 *   → client         Job seekers, VR candidates, SBA candidates, individuals
 *   → Deaf/HoH mode: DeafAUTH gate, visual-first, ASL video, no audio gates
 *   → Served via vendor (if through network) or directly via mbtq.dev (ssr)
 *
 * LIFECYCLE SEQUENTIAL (enforced by MBTQLifecycleRunner):
 *   IDEA → PROPOSAL → BUILD → GROW → MANAGED → SUNSET
 *   • Proposal stage: submitted to admin/agency for approval
 *   • Sunset: admin-gated — requires explicit case closure (VR case, SBA exit)
 *   • Sunset includes: resource handoff + lifetime support registration
 *   • Lifetime support: permanent Deaf/HoH accommodation record, never expires
 *
 * REPORTING PIPELINE:
 *   • Every lifecycle stage completion → auditLog() → auditQueue[]
 *   • buildEnd (production) → submitGovReport() → state + federal endpoints
 *   • VR: RSA-911 schema (case data, hours, outcomes)
 *   • WIOA: ETA/DOLETA participant records (Title I, Title II, Title IV)
 *   • SBA: Program participation + certification records
 *   • All payloads PASETO v4 signed, FibronRose anchored
 */
