// שלב 2: שליחה + Polling + כרטיסי סטטוס/תוצאה.
// עדיין אין כאן חילוץ שדות, Drive, Sheets או מייל — רק "מה קורה עם העבודה הזו עכשיו".
// לוגיקת הבקשות עצמה (submit + polling) לא השתנתה: אותם endpoints, אותו מרווח,
// אותו timeout, ואותו אלגוריתם "לא לתזמן קריאה הבאה לפני שהקודמת הסתיימה".

const SUBMIT_WEBHOOK_URL = "https://yovelharush.app.n8n.cloud/webhook/parse-submit";
const STATUS_WEBHOOK_URL = "https://yovelharush.app.n8n.cloud/webhook/parse-status";
// agentic נבחרה כהחלטת פרויקט מכוונת (איכות OCR עברית) — לא כתוצאת benchmark מול agentic_plus.
const TIER = "agentic"; // קבוע לייצור, ללא בורר בממשק.
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 90000;

// מאומת מול התיעוד הרשמי (לא הערכה): developers.llamaindex.ai/llamaparse/general/pricing
// רמת agentic = 10 קרדיטים לעמוד.
const CREDITS_PER_PAGE_AGENTIC = 10;

// מאומת מול developers.llamaindex.ai/llamaparse/general/limitations
// מגבלת העלאה כללית של שירות ה-Parse: 512MB.
const MAX_FILE_SIZE_BYTES = 512 * 1024 * 1024;

// ---------- DOM ----------

const card = document.getElementById("card");
const intro = document.getElementById("intro");
const form = document.getElementById("invoice-form");
const uploadBlock = document.getElementById("upload-block");

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("invoice-file");
const fileSummaryEl = document.getElementById("file-summary");
const fileSummaryIconEl = document.getElementById("file-summary-icon");
const fileSummaryNameEl = document.getElementById("file-summary-name");
const fileSummaryMetaEl = document.getElementById("file-summary-meta");
const fileRemoveBtn = document.getElementById("file-remove-btn");
const fileErrorEl = document.getElementById("file-error");
const submitBtn = document.getElementById("submit-btn");

const resultEl = document.getElementById("result");

const statusCard = document.getElementById("status-card");
const statusHeadlineEl = document.getElementById("status-headline");
const stagesList = document.getElementById("stages");
const metaElapsedEl = document.getElementById("meta-elapsed");
const metaChecksEl = document.getElementById("meta-checks");

const outcomeCard = document.getElementById("outcome-card");
const outcomeIconEl = document.getElementById("outcome-icon");
const outcomeTitleTextEl = document.getElementById("outcome-title-text");
const outcomeNoteEl = document.getElementById("outcome-note");
const outcomeErrorEl = document.getElementById("outcome-error");
const outcomeElapsedEl = document.getElementById("outcome-elapsed");
const outcomeChecksEl = document.getElementById("outcome-checks");
const retryBtn = document.getElementById("retry-btn");

const resultCard = document.getElementById("result-card");
const resultBannerIconEl = document.getElementById("result-banner-icon");
const resultBannerTextEl = document.getElementById("result-banner-text");
const resultBannerEl = document.getElementById("result-banner");
const invoiceAmountEl = document.getElementById("invoice-amount");
const invoiceSupplierHeadlineEl = document.getElementById("invoice-supplier-headline");
const invoiceDateHeadlineEl = document.getElementById("invoice-date-headline");
const gridSupplierEl = document.getElementById("grid-supplier");
const gridDateEl = document.getElementById("grid-date");
const gridNumberEl = document.getElementById("grid-number");
const gridCategoryEl = document.getElementById("grid-category");
const gridServiceEl = document.getElementById("grid-service");
const gridBeforeVatEl = document.getElementById("grid-before-vat");
const gridVatEl = document.getElementById("grid-vat");
const gridAfterVatEl = document.getElementById("grid-after-vat");
const driveActionEl = document.getElementById("drive-action");
const driveActionLinkEl = document.getElementById("drive-action-link");
const reviewWarningsEl = document.getElementById("review-warnings");
const reviewWarningsListEl = document.getElementById("review-warnings-list");
const resultElapsedEl = document.getElementById("result-elapsed");
const resultPagesEl = document.getElementById("result-pages");
const resultCreditsEl = document.getElementById("result-credits");
const resultChecksEl = document.getElementById("result-checks");
const copyBtn = document.getElementById("copy-btn");
const downloadBtn = document.getElementById("download-btn");
const copyFeedbackEl = document.getElementById("copy-feedback");
const markdownDebugContentEl = document.getElementById("markdown-debug-content");
const resetBtn = document.getElementById("reset-btn");

const techDetails = document.getElementById("tech-details");
const techJobIdEl = document.getElementById("tech-jobid");
const techRawStatusEl = document.getElementById("tech-raw-status");
const techDurationEl = document.getElementById("tech-duration");
const techChecksEl = document.getElementById("tech-checks");
const techDriveIdLabelEl = document.getElementById("tech-drive-id-label");
const techDriveIdEl = document.getElementById("tech-drive-id");
const copyJobIdBtn = document.getElementById("copy-jobid-btn");

// ---------- מצב ----------

let selectedFile = null;
let submittedFileName = null;
let isSubmitting = false;
let isPolling = false;
let pollStartedAt = 0;
let finalElapsedMs = null;
let pollTimer = null;
let elapsedTimerId = null;
let pollCount = 0;
let currentJobId = null;
let lastRawStatus = null;
let lastMarkdown = "";

// ---------- עזרי תצוגה ----------

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} בייט`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)}KB`;
  return `${(kb / 1024).toFixed(1)}MB`;
}

function fileTypeLabel(file) {
  const map = {
    "image/jpeg": "JPEG",
    "image/jpg": "JPEG",
    "image/png": "PNG",
    "image/heic": "HEIC",
    "image/heif": "HEIC",
    "image/webp": "WEBP",
    "application/pdf": "PDF",
  };
  if (map[file.type]) return map[file.type];
  const ext = file.name.split(".").pop();
  return ext ? ext.toUpperCase() : "קובץ";
}

function formatElapsedHuman(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds <= 0) return "פחות משנייה";
  if (totalSeconds === 1) return "שנייה אחת";
  if (totalSeconds < 60) return `${totalSeconds} שניות`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")} דקות`;
}

function getElapsedMs() {
  if (finalElapsedMs !== null) return finalElapsedMs;
  return Date.now() - pollStartedAt;
}

// ---------- עזרי תצוגת תוצאת חשבונית (שדות מהשרת, ולכן תמיד עם נפילות בטוחות) ----------

function formatIls(amount) {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "לא זוהה";
  return `₪${amount.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatInvoiceDate(dateStr) {
  if (typeof dateStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return "תאריך לא זוהה";
  const [y, m, d] = dateStr.split("-");
  const parsed = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "תאריך לא זוהה";
  return `${d}/${m}/${y}`;
}

function textOrFallback(value, fallback) {
  if (value === null || value === undefined) return fallback;
  const str = String(value).trim();
  return str ? str : fallback;
}

// מחזיר URL רק אם הוא מחרוזת http/https תקינה. לעולם לא בונה URL בעצמו.
function safeHttpUrl(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
  } catch (error) {
    return null;
  }
  return null;
}

// ---------- מעברי תצוגה (עם אנימציית כניסה עדינה) ----------

function revealSection(el) {
  el.hidden = false;
  el.classList.remove("is-in");
  void el.offsetWidth; // reflow, כדי שהמעבר יופעל
  el.classList.add("is-in");
}

function concealSection(el) {
  el.hidden = true;
  el.classList.remove("is-in");
}

// view: "idle" | "processing" | "outcome" | "result"
function setView(view) {
  const isIdle = view === "idle";
  intro.hidden = !isIdle;
  uploadBlock.hidden = !isIdle;

  if (view === "processing") revealSection(statusCard);
  else concealSection(statusCard);

  if (view === "outcome") revealSection(outcomeCard);
  else concealSection(outcomeCard);

  if (view === "result") revealSection(resultCard);
  else concealSection(resultCard);

  techDetails.hidden = isIdle;
  card.classList.toggle("card--wide", view === "result");
}

function showResult(state, message) {
  resultEl.hidden = false;
  resultEl.dataset.state = state;
  resultEl.textContent = message;
}

function hideResult() {
  resultEl.hidden = true;
  resultEl.removeAttribute("data-state");
  resultEl.innerHTML = "";
}

function setFormEnabled(enabled) {
  fileInput.disabled = !enabled;
  fileRemoveBtn.disabled = !enabled;
  dropzone.classList.toggle("dropzone--disabled", !enabled);
}

function setStage(index, headline) {
  const items = stagesList.querySelectorAll(".stages__item");
  items.forEach((li, i) => {
    li.classList.toggle("is-done", i < index);
    li.classList.toggle("is-active", i === index);
  });
  if (headline) statusHeadlineEl.textContent = headline;
}

function updateTechDetails() {
  techJobIdEl.textContent = currentJobId || "—";
  techRawStatusEl.textContent = lastRawStatus || "—";
  techDurationEl.textContent = formatElapsedHuman(getElapsedMs());
  techChecksEl.textContent = String(pollCount);
}

// ---------- בחירת קובץ: קליק, גרירה, ולידציה ----------

function validateFile(file) {
  if (!file) return { valid: false, message: "לא נבחר קובץ." };
  if (file.size === 0) return { valid: false, message: "הקובץ ריק או פגום. נסו לצלם או לבחור קובץ אחר." };
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { valid: false, message: `הקובץ גדול מדי (מעל ${formatFileSize(MAX_FILE_SIZE_BYTES)}).` };
  }
  const isImage = file.type.startsWith("image/");
  const isPdf = file.type === "application/pdf";
  const hasKnownExtension = /\.(jpe?g|png|heic|heif|webp|pdf)$/i.test(file.name);
  if (!isImage && !isPdf && !hasKnownExtension) {
    return { valid: false, message: "סוג קובץ לא נתמך. יש להעלות תמונה (JPG/PNG/HEIC) או PDF." };
  }
  return { valid: true };
}

function handleFileSelected(file) {
  const validation = validateFile(file);

  if (!validation.valid) {
    fileInput.value = "";
    selectedFile = null;
    fileSummaryEl.hidden = true;
    dropzone.hidden = false;
    fileErrorEl.hidden = false;
    fileErrorEl.textContent = validation.message;
    submitBtn.disabled = true;
    return;
  }

  fileErrorEl.hidden = true;
  fileErrorEl.textContent = "";
  selectedFile = file;

  fileSummaryIconEl.textContent = file.type === "application/pdf" ? "📕" : "🖼️";
  fileSummaryNameEl.textContent = file.name;
  fileSummaryMetaEl.textContent = `${fileTypeLabel(file)} · ${formatFileSize(file.size)}`;
  fileSummaryEl.hidden = false;
  dropzone.hidden = true;

  submitBtn.disabled = false;
}

fileInput.addEventListener("change", () => {
  handleFileSelected(fileInput.files[0]);
});

fileRemoveBtn.addEventListener("click", () => {
  fileInput.value = "";
  selectedFile = null;
  fileSummaryEl.hidden = true;
  dropzone.hidden = false;
  fileErrorEl.hidden = true;
  fileErrorEl.textContent = "";
  submitBtn.disabled = true;
});

dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("dropzone--dragover");
});

["dragleave", "dragend"].forEach((evt) => {
  dropzone.addEventListener(evt, () => {
    dropzone.classList.remove("dropzone--dragover");
  });
});

dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("dropzone--dragover");
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  try {
    fileInput.files = event.dataTransfer.files;
  } catch (error) {
    console.warn("[invoices-k7m2p] could not sync dropped file to the input element:", error);
  }
  handleFileSelected(file);
});

// ---------- עזרי תשובת Webhook ----------
// n8n עם respondWith: "allIncomingItems" מחזיר לפעמים אובייקט בודד ולפעמים מערך עם פריט אחד.

async function parseJsonResponse(response) {
  const rawText = await response.text();
  if (!rawText) return null;
  try {
    return JSON.parse(rawText);
  } catch (err) {
    console.warn("[invoices-k7m2p] response is not valid JSON:", err, rawText);
    return null;
  }
}

function unwrapItem(parsed) {
  if (Array.isArray(parsed)) return parsed[0] ?? null;
  return parsed;
}

// ---------- שליחה ----------

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  // מגן כפול נגד לחיצה כפולה: גם דגל וגם ניטרול מיידי של הבקרות.
  if (isSubmitting) return;
  const file = selectedFile || fileInput.files[0];
  if (!file) return;

  const validation = validateFile(file);
  if (!validation.valid) {
    fileErrorEl.hidden = false;
    fileErrorEl.textContent = validation.message;
    return;
  }

  isSubmitting = true;
  submitBtn.disabled = true;
  submitBtn.textContent = "שולח…";
  setFormEnabled(false);
  hideResult();
  showResult("pending", "שולח את החשבונית…");

  submittedFileName = file.name;
  pollCount = 0;
  lastRawStatus = null;
  lastMarkdown = "";
  finalElapsedMs = null;

  const formData = new FormData();
  formData.append("document", file);
  formData.append("tier", TIER);
  formData.append("fileName", file.name);

  console.log("[invoices-k7m2p] submitting", {
    url: SUBMIT_WEBHOOK_URL,
    tier: TIER,
    fileName: file.name,
    fileSize: file.size,
  });

  try {
    const response = await fetch(SUBMIT_WEBHOOK_URL, {
      method: "POST",
      body: formData,
    });

    const data = unwrapItem(await parseJsonResponse(response));
    console.log("[invoices-k7m2p] submit response status:", response.status, "body:", data);

    if (!response.ok) {
      throw new Error(`השרת החזיר סטטוס ${response.status}`);
    }

    const jobId = data?.jobId;
    if (!jobId) {
      throw new Error("התקבלה תשובה תקינה אך בלי jobId. בדקו את הלוג בקונסול.");
    }

    currentJobId = jobId;
    lastRawStatus = data.status || null;

    // מעבר לכרטיס העיבוד. שלבים 0+1 כבר עובדה: החשבונית נשלחה ומזהה העבודה התקבל.
    hideResult();
    pollStartedAt = Date.now();
    setView("processing");
    setStage(2, "המסמך עדיין בעיבוד…");
    updateTechDetails();
    startElapsedTicker();

    isPolling = true;
    pollOnce(jobId);
  } catch (error) {
    console.error("[invoices-k7m2p] submit failed:", error);
    showResult("error", `השליחה נכשלה: ${error.message}`);
    isSubmitting = false;
    setFormEnabled(true);
    submitBtn.disabled = false;
    submitBtn.textContent = "שליחת החשבונית";
  }
});

// ---------- שעון זמן שחלף (חי, לתצוגה בלבד — לא משפיע על לוגיקת ה-Polling) ----------

function startElapsedTicker() {
  stopElapsedTicker();
  elapsedTimerId = setInterval(() => {
    metaElapsedEl.textContent = formatElapsedHuman(getElapsedMs());
    metaChecksEl.textContent = String(pollCount);
    updateTechDetails();
  }, 1000);
}

function stopElapsedTicker() {
  if (elapsedTimerId) {
    clearInterval(elapsedTimerId);
    elapsedTimerId = null;
  }
}

// ---------- Polling ----------
// ללא חפיפה: הקריאה הבאה מתוזמנת רק אחרי שהקודמת הסתיימה (הצלחה, כישלון, או timeout).

function scheduleNextPoll(jobId) {
  if (!isPolling) return;
  const elapsed = Date.now() - pollStartedAt;
  if (elapsed >= POLL_TIMEOUT_MS) {
    handleTimeout();
    return;
  }
  pollTimer = setTimeout(() => pollOnce(jobId), POLL_INTERVAL_MS);
}

async function pollOnce(jobId) {
  if (!isPolling) return;

  const elapsed = Date.now() - pollStartedAt;
  if (elapsed >= POLL_TIMEOUT_MS) {
    handleTimeout();
    return;
  }

  // נספר כל בקשת סטטוס בפועל, גם אם היא תיכשל ברשת.
  pollCount += 1;
  metaChecksEl.textContent = String(pollCount);

  try {
    const response = await fetch(STATUS_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    });

    const data = unwrapItem(await parseJsonResponse(response));
    console.log("[invoices-k7m2p] status poll:", response.status, "body:", data);

    if (!response.ok || !data) {
      console.warn("[invoices-k7m2p] status poll returned no usable data, will retry");
      scheduleNextPoll(jobId);
      return;
    }

    lastRawStatus = data.status || lastRawStatus;

    if (data.done && data.status === "COMPLETED") {
      handleCompleted(data);
      return;
    }

    if (data.done && (data.status === "FAILED" || data.status === "CANCELLED")) {
      handleFailed(data);
      return;
    }

    // עדיין רץ (done === false)
    scheduleNextPoll(jobId);
  } catch (error) {
    console.warn("[invoices-k7m2p] status poll network error, will retry:", error);
    scheduleNextPoll(jobId);
  }
}

// ---------- מצבי סיום ----------

function handleCompleted(data) {
  isPolling = false;
  finalElapsedMs = Date.now() - pollStartedAt;
  stopElapsedTicker();
  setStage(4, null); // כל השלבים הושלמו

  lastMarkdown = typeof data.markdown === "string" ? data.markdown : "";
  const pages = typeof data.pages === "number" ? data.pages : null;
  const credits = pages !== null ? pages * CREDITS_PER_PAGE_AGENTIC : null;

  resultElapsedEl.textContent = formatElapsedHuman(finalElapsedMs);
  resultPagesEl.textContent = pages !== null ? String(pages) : "לא התקבל";
  resultCreditsEl.textContent = credits !== null ? String(credits) : "לא ניתן לחשב";
  resultChecksEl.textContent = String(pollCount);
  markdownDebugContentEl.textContent = lastMarkdown || "(לא התקבל טקסט)";

  renderInvoiceResult(data);

  updateTechDetails();
  setView("result");
}

// מציג את תוצאת החשבונית העסקית: שדות מאומתים מהשרת בלבד, VAT מחושב בצד הלקוח,
// דורש-בדיקה כאזהרה (לא ככישלון), וקישור Drive רק אם קיים URL תקין אמיתי.
function renderInvoiceResult(data) {
  const supplier = textOrFallback(data.supplier, "ספק לא ידוע");
  const invoiceDateLabel = formatInvoiceDate(data.invoice_date);
  const invoiceNumber = textOrFallback(data.invoice_number, "לא זוהה");
  const category = textOrFallback(data.category, "לא סווג");
  const serviceType = textOrFallback(data.service_type, "לא זוהה");

  const before = typeof data.amount_before_vat === "number" ? data.amount_before_vat : null;
  const after = typeof data.amount_after_vat === "number" ? data.amount_after_vat : null;
  const vat = before !== null && after !== null ? Math.round((after - before) * 100) / 100 : null;

  const needsReview = data.needs_review === true;

  // באנר: הצלחה מלאה מול "מומלץ לבדוק" — לעולם לא כישלון טכני.
  if (needsReview) {
    resultBannerEl.classList.add("result-banner--review");
    resultBannerIconEl.textContent = "⚠";
    resultBannerTextEl.textContent = "החשבונית נקלטה, אך מומלץ לבדוק חלק מהפרטים";
  } else {
    resultBannerEl.classList.remove("result-banner--review");
    resultBannerIconEl.textContent = "✔";
    resultBannerTextEl.textContent = "החשבונית נקלטה ועובדה בהצלחה";
  }

  invoiceAmountEl.textContent = formatIls(after);
  invoiceSupplierHeadlineEl.textContent = supplier;
  invoiceDateHeadlineEl.textContent = invoiceDateLabel;

  gridSupplierEl.textContent = supplier;
  gridDateEl.textContent = invoiceDateLabel;
  gridNumberEl.textContent = invoiceNumber;
  gridCategoryEl.textContent = category;
  gridServiceEl.textContent = serviceType;
  gridBeforeVatEl.textContent = formatIls(before);
  gridVatEl.textContent = formatIls(vat);
  gridAfterVatEl.textContent = formatIls(after);

  // קישור Drive: רק אם השרת סיפק URL אמיתי ותקין. לעולם לא בונים URL בעצמנו.
  const driveUrl = safeHttpUrl(data.drive_file_url);
  if (driveUrl) {
    driveActionLinkEl.setAttribute("href", driveUrl);
    driveActionEl.hidden = false;
  } else {
    driveActionLinkEl.removeAttribute("href");
    driveActionEl.hidden = true;
  }

  // מזהה קובץ Drive גולמי — רק באזור הטכני המכווץ, לא בתצוגה הראשית.
  if (typeof data.drive_file_id === "string" && data.drive_file_id) {
    techDriveIdEl.textContent = data.drive_file_id;
    techDriveIdLabelEl.hidden = false;
    techDriveIdEl.hidden = false;
  } else {
    techDriveIdEl.textContent = "";
    techDriveIdLabelEl.hidden = true;
    techDriveIdEl.hidden = true;
  }

  // אזהרות בדיקה, אם קיימות.
  reviewWarningsListEl.textContent = "";
  const warnings = Array.isArray(data.validation_warnings) ? data.validation_warnings : [];
  if (warnings.length > 0) {
    warnings.forEach((warning) => {
      const li = document.createElement("li");
      li.dir = "auto"; // אזהרות מהשרת עלולות להיות באנגלית; לא לכפות עליהן כיוון RTL
      li.textContent = String(warning);
      reviewWarningsListEl.appendChild(li);
    });
    reviewWarningsEl.hidden = false;
  } else {
    reviewWarningsEl.hidden = true;
  }
}

function handleFailed(data) {
  isPolling = false;
  finalElapsedMs = Date.now() - pollStartedAt;
  stopElapsedTicker();

  outcomeIconEl.textContent = "⚠";
  outcomeTitleTextEl.textContent = "עיבוד החשבונית נכשל";
  outcomeNoteEl.textContent = "אירעה תקלה בעיבוד החשבונית. אפשר לנסות שוב עם אותו קובץ או עם קובץ אחר.";

  if (data.message) {
    outcomeErrorEl.hidden = false;
    outcomeErrorEl.textContent = `פרטים מהשרת: ${data.message}`;
  } else {
    outcomeErrorEl.hidden = true;
    outcomeErrorEl.textContent = "";
  }

  outcomeElapsedEl.textContent = formatElapsedHuman(finalElapsedMs);
  outcomeChecksEl.textContent = String(pollCount);

  updateTechDetails();
  setView("outcome");
}

function handleTimeout() {
  isPolling = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  finalElapsedMs = Date.now() - pollStartedAt;
  stopElapsedTicker();

  outcomeIconEl.textContent = "⏱";
  outcomeTitleTextEl.textContent = "העיבוד לוקח יותר מהצפוי";
  outcomeNoteEl.textContent =
    "הפסקנו להמתין לתוצאה כאן, אך ייתכן שהחשבונית עדיין ממשיכה להתעבד ברקע. לא נשלחה החשבונית שוב באופן אוטומטי — ניתן לנסות שוב או לבדוק מאוחר יותר.";
  outcomeErrorEl.hidden = true;
  outcomeErrorEl.textContent = "";

  outcomeElapsedEl.textContent = formatElapsedHuman(finalElapsedMs);
  outcomeChecksEl.textContent = String(pollCount);

  updateTechDetails();
  setView("outcome");
}

// ---------- פעולות על התוצאה: העתקה / הורדה ----------

function deriveResultFilename(originalName) {
  const base = (originalName || "חשבונית").replace(/\.[^./\\]+$/, "");
  return `${base}.md`;
}

copyBtn.addEventListener("click", async () => {
  if (!lastMarkdown) return;
  try {
    await navigator.clipboard.writeText(lastMarkdown);
    copyFeedbackEl.textContent = "הועתק ללוח!";
  } catch (error) {
    console.error("[invoices-k7m2p] copy failed:", error);
    copyFeedbackEl.textContent = "ההעתקה נכשלה. ניתן לבחור ולהעתיק ידנית מהתיבה למטה.";
  }
  setTimeout(() => {
    copyFeedbackEl.textContent = "";
  }, 4000);
});

downloadBtn.addEventListener("click", () => {
  if (!lastMarkdown) return;
  const blob = new Blob([lastMarkdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = deriveResultFilename(submittedFileName);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

copyJobIdBtn.addEventListener("click", async () => {
  if (!currentJobId) return;
  try {
    await navigator.clipboard.writeText(currentJobId);
    const original = copyJobIdBtn.textContent;
    copyJobIdBtn.textContent = "הועתק";
    setTimeout(() => {
      copyJobIdBtn.textContent = original;
    }, 2000);
  } catch (error) {
    console.error("[invoices-k7m2p] copy jobId failed:", error);
  }
});

// ---------- איפוס ----------

function resetToIdle() {
  isSubmitting = false;
  isPolling = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  stopElapsedTicker();

  currentJobId = null;
  pollCount = 0;
  lastRawStatus = null;
  lastMarkdown = "";
  finalElapsedMs = null;
  pollStartedAt = 0;
  submittedFileName = null;
  selectedFile = null;

  form.reset();
  fileSummaryEl.hidden = true;
  dropzone.hidden = false;
  dropzone.classList.remove("dropzone--disabled", "dropzone--dragover");
  fileErrorEl.hidden = true;
  fileErrorEl.textContent = "";
  submitBtn.disabled = true;
  submitBtn.textContent = "שליחת החשבונית";

  hideResult();
  markdownDebugContentEl.textContent = "";
  copyFeedbackEl.textContent = "";

  resultBannerEl.classList.remove("result-banner--review");
  resultBannerIconEl.textContent = "✔";
  resultBannerTextEl.textContent = "החשבונית נקלטה ועובדה בהצלחה";
  driveActionEl.hidden = true;
  driveActionLinkEl.removeAttribute("href");
  reviewWarningsEl.hidden = true;
  reviewWarningsListEl.textContent = "";
  techDriveIdLabelEl.hidden = true;
  techDriveIdEl.hidden = true;
  techDriveIdEl.textContent = "";

  stagesList.querySelectorAll(".stages__item").forEach((li) => {
    li.classList.remove("is-done", "is-active");
  });

  setView("idle");
}

retryBtn.addEventListener("click", resetToIdle);
resetBtn.addEventListener("click", resetToIdle);
