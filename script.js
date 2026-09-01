/*
  נגריית אלון — script.js
  שלב 4: חיבור טופס יצירת הקשר ל-webhook של n8n.
  שלב 5: מערכת reveal בגלילה + כניסת Hero (IntersectionObserver אחד, ללא scroll listener).
  קוד מינימלי, ללא dependencies וללא ספריות חיצוניות.
*/

/* --- טופס יצירת קשר (לוגיקת השליחה — ללא שינוי) --- */
(function () {
  "use strict";

  var WEBHOOK_URL = "https://yovelharush.app.n8n.cloud/webhook/nagariyat-alon-contact";

  var form = document.getElementById("contact-form");
  if (!form) {
    return;
  }

  var submitButton = form.querySelector(".contact-form__submit");
  var statusEl = document.getElementById("form-status");
  var defaultButtonText = submitButton.textContent;

  function renderStatus(state, title, detail) {
    statusEl.className = "form-status form-status--" + state;
    statusEl.innerHTML = "";

    var titleEl = document.createElement("strong");
    titleEl.className = "form-status__title";
    titleEl.textContent = title;
    statusEl.appendChild(titleEl);

    if (detail) {
      var detailEl = document.createElement("span");
      detailEl.className = "form-status__detail";
      detailEl.textContent = detail;
      statusEl.appendChild(detailEl);
    }
  }

  function clearStatus() {
    statusEl.className = "form-status";
    statusEl.innerHTML = "";
  }

  function setSending(isSending) {
    submitButton.disabled = isSending;
    submitButton.textContent = isSending ? "שולח את הפרטים..." : defaultButtonText;
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    // ולידציה מובנית של הדפדפן (required, type="email") — לפני כל שליחה.
    if (!form.reportValidity()) {
      return;
    }

    var formData = new FormData(form);
    var payload = {
      name: String(formData.get("name") || "").trim(),
      phone: String(formData.get("phone") || "").trim(),
      email: String(formData.get("email") || "").trim(),
      message: String(formData.get("message") || "").trim()
    };

    clearStatus();
    setSending(true);
    renderStatus("sending", "שולח את הפנייה...");

    fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("n8n webhook returned status " + response.status);
        }
        renderStatus("success", "תודה, הרעיון שלכם הגיע.", "הפרטים נשלחו בהצלחה.");
        form.reset();
      })
      .catch(function (error) {
        console.error("נגריית אלון: שליחת הטופס נכשלה.", error);
        renderStatus("error", "לא הצלחנו לשלוח את הפרטים.", "אפשר לנסות שוב בעוד רגע.");
      })
      .then(function () {
        setSending(false);
      });
  });
})();

/* --- אנימציות: כניסת Hero + reveal בגלילה --- */
(function () {
  "use strict";

  var prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function markLoaded() {
    document.body.classList.add("is-loaded");
  }
  if (document.readyState === "complete") {
    markLoaded();
  } else {
    window.addEventListener("load", markLoaded, { once: true });
  }

  var revealEls = document.querySelectorAll(".reveal, .media-reveal");
  if (!revealEls.length) {
    return;
  }

  if (prefersReduced || !("IntersectionObserver" in window)) {
    revealEls.forEach(function (el) { el.classList.add("is-visible"); });
    return;
  }

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { rootMargin: "0px 0px -5% 0px", threshold: 0 });

  revealEls.forEach(function (el) { observer.observe(el); });

  // רשת ביטחון: אם משום מה אלמנט לא נחשף, ודא שהוא מוצג לאחר זמן קצר
  window.setTimeout(function () {
    revealEls.forEach(function (el) {
      if (!el.classList.contains("is-visible")) {
        el.classList.add("is-visible");
        observer.unobserve(el);
      }
    });
  }, 3000);
})();
