(() => {
  const PVT_SRC = "https://unpkg.com/petite-vue/dist/petite-vue.iife.js"; // window.PetiteVue

  // ---- 小工具 ----
  const onReady = (fn) => (document.readyState === "loading")
    ? document.addEventListener("DOMContentLoaded", fn, { once: true })
    : fn();

  const loadPetiteVueIfNeeded = () => new Promise((resolve, reject) => {
    if (window.PetiteVue && window.PetiteVue.createApp) return resolve();
    const s = document.createElement("script");
    s.src = PVT_SRC;
    s.defer = true;
    s.onload = () => (window.PetiteVue && window.PetiteVue.createApp) ? resolve() : reject(new Error("PetiteVue load failed"));
    s.onerror = () => reject(new Error("PetiteVue network error"));
    document.head.appendChild(s);
  });

  // --- 迷你 CSV 解析器（支援引號、跳脫、任意分隔符、CRLF） ---
  function parseCSV(text, { delimiter = ",", trim = true, header = "auto" } = {}) {
    const rows = [];
    let i = 0, cur = "", row = [], inQuotes = false;
    const pushCell = () => row.push(trim ? cur.trim() : cur);
    const pushRow = () => { rows.push(row); row = []; };
    while (i < text.length) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cur += '"'; i += 2; continue; } // 連續兩個雙引號 -> 轉義 "
          inQuotes = false; i++; continue;
        } else { cur += ch; i++; continue; }
      } else {
        if (ch === '"') { inQuotes = true; i++; continue; }
        if (ch === delimiter) { pushCell(); cur = ""; i++; continue; }
        if (ch === "\n" || ch === "\r") {
          pushCell(); cur = "";
          // 處理 CRLF
          if (ch === "\r" && text[i + 1] === "\n") i++;
          i++; pushRow(); continue;
        }
        cur += ch; i++;
      }
    }
    pushCell(); pushRow();

    // 移除可能的最後一列空白行
    if (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") rows.pop();

    // 判斷是否有表頭
    let useHeader;
    if (header === "auto") {
      // 簡單啟發式：第一列所有欄位都「非空且不含數字-only」且唯一性高 → 當表頭
      if (rows.length >= 2) {
        const first = rows[0];
        const unique = new Set(first.map(v => v.toLowerCase())).size === first.length;
        const nonEmpty = first.every(v => v !== "");
        useHeader = unique && nonEmpty;
      } else useHeader = false;
    } else {
      useHeader = header === true || header === "true";
    }

    if (useHeader) {
      const headers = rows.shift();
      return rows.map(r => {
        const o = {};
        for (let j = 0; j < headers.length; j++) o[headers[j]] = r[j] ?? "";
        return o;
      });
    }
    return rows;
  }

  // 轉 {#each}/{#if} 與 {expr} → Vue 模板
  const transformTemplate = (html) => {
    if (!html) return html;
    html = html.replace(
      /\{#each\s+([^}]+?)\s+as\s+([A-Za-z_$][\w$]*)(?:\s*,\s*([A-Za-z_$][\w$]*))?\}([\s\S]*?)\{\/each\}/g,
      (_m, list, item, i, body) => `<template v-for="(${item}${i ? "," + i : ""}) in ${list}">${body}</template>`
    );
    html = html.replace(
      /\{#if\s+([^}]+)\}([\s\S]*?)\{\/if\}/g,
      (_m, cond, body) => `<template v-if="${cond}">${body}</template>`
    );
    html = html.replace(/\{([^{}]+)\}/g, (_m, expr) => `{{ ${expr.trim()} }}`);
    return html;
  };

  // 判斷是否 CSV
  const shouldTreatAsCSV = (src, contentType, forcedType) => {
    if (forcedType === "csv") return true;
    if ((contentType || "").includes("text/csv")) return true;
    try { if (new URL(src, location.href).pathname.toLowerCase().endsWith(".csv")) return true; } catch {}
    return false;
  };

  // 依容器屬性建立 v-scope 與初始化
  const prepareContainer = (el) => {
    const src = el.getAttribute("data_src");
    if (!src) return;
    const arg = el.getAttribute("closure_arg") || "data";
    const original = el.getAttribute("data-template-original") || el.innerHTML;

    const forcedType = (el.getAttribute("data_src_type") || "").toLowerCase() || null;
    const csvDelim = el.getAttribute("data_csv_delim") || ",";
    const csvHeader = el.getAttribute("data_csv_header"); // "true" | "false" | null(auto)
    const csvTrim = (el.getAttribute("data_csv_trim") || "true").toLowerCase() !== "false";

    // 1) 轉模板
    const tpl = transformTemplate(original);

    // 2) 設定 v-scope
    el.setAttribute("v-scope", `{ ${arg}: {}, __err: null, __loading: true }`);

    // 3) 包裝模板（可自行刪除）
    const wrapped = `
      <template v-if="!__err">
        <template v-if="!__loading">
          ${tpl}
        </template>
        <span v-else style="opacity:.7;">Loading…</span>
      </template>
      <pre v-else style="color:#c00;background:#fff5f5;padding:.5em;border:1px solid #f3caca;white-space:pre-wrap;">{{ __err }}</pre>
    `;
    el.innerHTML = wrapped;

    // 4) 初始化取資料（自動判斷 JSON / CSV）
    el.__pva_init__ = function () {
      fetch(src, { credentials: "same-origin" })
        .then(async r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const type = r.headers.get("content-type") || "";
          const isCSV = shouldTreatAsCSV(src, type, forcedType);
          const txt = await r.text();

          if (isCSV) {
            const headerOpt = (csvHeader == null) ? "auto" : csvHeader;
            const parsed = parseCSV(txt, { delimiter: csvDelim, trim: csvTrim, header: headerOpt });
            this[arg] = parsed;
          } else {
            // 若不是 CSV 就當 JSON（容錯：text->JSON）
            try { this[arg] = JSON.parse(txt); }
            catch { throw new Error("Invalid JSON"); }
          }
          this.__loading = false;
        })
        .catch(e => { this.__err = String(e && e.message || e); this.__loading = false; });
    };

    // 5) 清理自定屬性
    el.removeAttribute("data_src");
    el.removeAttribute("closure_arg");
    el.setAttribute("data-template-original", original);
  };

  // 啟動：掃描 + 掛 petite-vue
  const mountAll = () => {
    const nodes = Array.from(document.querySelectorAll("[data_src]"));
    if (nodes.length === 0) return;
    nodes.forEach(prepareContainer);

    const app = window.PetiteVue.createApp({});
    nodes.forEach(el => {
      app.mount(el);
      if (typeof el.__pva_init__ === "function") {
        requestAnimationFrame(() => el.__pva_init__.call(el.__v_scope));
      }
    });
  };

  onReady(() => {
    loadPetiteVueIfNeeded()
      .then(mountAll)
      .catch(err => {
        console.error("[datasrc-vue-adapter] Failed:", err);
        document.querySelectorAll("[data_src]").forEach(el => {
          el.innerHTML = `<pre style="color:#c00;">Adapter failed: ${String(err && err.message || err)}</pre>`;
        });
      });
  });
})();
