// Quill initialization
const quill = new Quill('#editor', {
  theme: 'snow',
  modules: {
    toolbar: '#toolbar'
  }
});

const sanitizeBtn = document.getElementById('sanitizeBtn');
const copyBtn = document.getElementById('copyBtn');
const outputDiv = document.getElementById('output');

const options = {
  get removeZeroWidth() { return document.getElementById('removeZeroWidth').checked; },
  get removeBidi() { return document.getElementById('removeBidi').checked; },
  get normalizeSpaces() { return document.getElementById('normalizeSpaces').checked; },
  get collapseBlankLines() { return document.getElementById('collapseBlankLines').checked; },
  get expandLatinAbbrev() { return document.getElementById('expandLatinAbbrev').checked; },
};


// Latin / English abbreviations to expand when "Expand Latin abbreviations" is enabled
const LATIN_ABBREVIATIONS = [
  // E.g. → for example
  { pattern: /\b[eE]\.g\./g, replacement: 'for example' },

  // I.e. → that is
  { pattern: /\b[iI]\.e\./g, replacement: 'that is' },

  // Etc. → and so on
  { pattern: /\betc\./gi, replacement: 'and so on' },

  // Vs. → versus
  { pattern: /\bvs\./gi, replacement: 'versus' },

  // Cf. → compare
  { pattern: /\bcf\./gi, replacement: 'compare' },

  // Et al. → and others
  { pattern: /\bet al\./gi, replacement: 'and others' },
];

// --- Core sanitization logic ------------------------------------

function sanitizeTextContent(text, opts) {
  if (typeof text.normalize === 'function') {
    text = text.normalize('NFC');
  }

  if (opts.removeZeroWidth) {
    text = text.replace(/[\u200B\u200C\u200D\uFEFF]/g, '');
  }

  if (opts.removeBidi) {
    text = text.replace(/[\u202A-\u202E\u2066-\u2069]/g, '');
  }

  if (opts.normalizeSpaces) {
    text = text.replace(/[\u00A0\u202F]/g, ' ');
  }

  // Replace ONLY EM DASH (—) with a clean "; "
  text = text
    .replace(/\s*\u2014\s*/g, '; ')
    .replace(/;\s+/g, '; ');  // ensure exactly one space after ;

  // Normalize ALL other dash-like characters to ASCII hyphen (-)
  text = text.replace(
    /[\u2010\u2011\u2012\u2013\u2015\u2212\uFE63\uFF0D\u30FC\u2043\u2E3A\u2E3B]/g,
    '-'
  );

  // Expand Latin / English abbreviations if enabled
  if (opts.expandLatinAbbrev) {
    LATIN_ABBREVIATIONS.forEach(({ pattern, replacement }) => {
      text = text.replace(pattern, replacement);
    });
  }

  return text;
}

function sanitizeHtmlPreservingFormatting(html, opts) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  function walk(node) {
    node.childNodes.forEach(child => {
      if (child.nodeType === Node.TEXT_NODE) {
        child.nodeValue = sanitizeTextContent(child.nodeValue, opts);
      } else {
        walk(child);
      }
    });
  }

  walk(doc.body);

  let cleanedHtml = doc.body.innerHTML;

  if (opts.collapseBlankLines) {
    cleanedHtml = cleanedHtml
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n{3,}/g, '\n\n');
  }

  // ------- HTML NORMALIZATION FIXES ------- //

  // Remove whitespace between tags
  cleanedHtml = cleanedHtml.replace(/>\s+</g, '><');

  // Collapse multiple <br> to one
  cleanedHtml = cleanedHtml.replace(/(<br\s*\/?>\s*){2,}/gi, '<br>');

  // Normalize Quill blank paragraphs
  cleanedHtml = cleanedHtml.replace(/<p><br><\/p>/gi, '<p></p>');

  // Remove completely empty paragraphs
  cleanedHtml = cleanedHtml.replace(/<p>\s*<\/p>/gi, '');

  // Collapse repeated empty paragraphs
  cleanedHtml = cleanedHtml.replace(/(<p>\s*<\/p>){2,}/gi, '<p></p>');

  // ---------- XSS PROTECTION: sanitize with DOMPurify ---------- //
  if (window.DOMPurify) {
    cleanedHtml = DOMPurify.sanitize(cleanedHtml, {
      ALLOWED_TAGS: [
        'p', 'br', 'div', 'span',
        'b', 'strong', 'i', 'em', 'u',
        'ul', 'ol', 'li'
      ],
      ALLOWED_ATTR: [
        'class' // allow Quill's classes for lists / formatting
      ]
    });
  }

  return cleanedHtml;
}




// ==================== HIGHLIGHT SYSTEM ====================

// Remove previous highlight spans inside editor
function clearHighlightsInEditor() {
  const root = quill.root;
  const spans = root.querySelectorAll('.highlight-invisible');
  spans.forEach(span => {
    const text = document.createTextNode(span.textContent);
    span.replaceWith(text);
  });
}

// Highlight invisibles + EM DASH inside editor
function highlightProblemCharsInEditor() {
  clearHighlightsInEditor();

  const opts = options;
  const root = quill.root;

  function walk(node) {
    node.childNodes.forEach(child => {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.nodeValue;

        // Fast skip if nothing suspicious
        if (!/[\u200B\u200C\u200D\uFEFF\u202A-\u202E\u2066-\u2069\u200E\u200F\u00A0\u202F\u2014]/.test(text)) {
          return;
        }

        const frag = document.createDocumentFragment();

        for (let i = 0; i < text.length; i++) {
          const ch = text[i];
          let label = null;

          // Zero-width chars
          if (opts.removeZeroWidth && /[\u200B\u200C\u200D\uFEFF]/.test(ch)) {
            label = "Zero-width character";
          }
          // BiDi control chars (including LRM/RLM)
          else if (opts.removeBidi && /[\u202A-\u202E\u2066-\u2069\u200E\u200F]/.test(ch)) {
            label = "BiDi / Direction marker";
          }
          // Non-breaking spaces
          else if (opts.normalizeSpaces && /[\u00A0\u202F]/.test(ch)) {
            label = "Non-breaking space";
          }
          // EM DASH specifically (because you're converting it to "; ")
          else if (ch === '\u2014') {
            label = "EM DASH — (will become '; ' )";
          }
          // Fallback: highlight ANY non-ASCII char (for debugging)
          else if (ch.charCodeAt(0) > 127) {
            label = "Non-ASCII character";
          }


          if (label) {
            const span = document.createElement('span');
            span.className = 'highlight-invisible';
            span.textContent = ch;
            span.title = label;
            frag.appendChild(span);
          } else {
            frag.appendChild(document.createTextNode(ch));
          }
        }

        child.replaceWith(frag);
      } else {
        walk(child);
      }
    });
  }

  walk(root);
}

// Debounced trigger
let highlightTimer = null;
function scheduleHighlight() {
  clearTimeout(highlightTimer);
  highlightTimer = setTimeout(highlightProblemCharsInEditor, 120);
}

// Reconstruct raw HTML without highlight spans
function getCleanHtmlFromEditor() {
  const clone = quill.root.cloneNode(true);
  const spans = clone.querySelectorAll('.highlight-invisible');
  spans.forEach(span => {
    span.replaceWith(document.createTextNode(span.textContent));
  });
  return clone.innerHTML;
}




// --- Events -----------------------------------------------------

sanitizeBtn.addEventListener('click', () => {
  const html = getCleanHtmlFromEditor();   // NEW: remove highlight spans first
  const cleanedHtml = sanitizeHtmlPreservingFormatting(html, options);
  outputDiv.innerHTML = cleanedHtml;
});

quill.on('text-change', scheduleHighlight);

['removeZeroWidth', 'removeBidi', 'normalizeSpaces', 'collapseBlankLines', 'expandLatinAbbrev'].forEach(id => {
  document.getElementById(id).addEventListener('change', scheduleHighlight);
});

// Initial run
scheduleHighlight();


copyBtn.addEventListener('click', () => {
  const selection = window.getSelection();
  selection.removeAllRanges();

  const range = document.createRange();
  range.selectNodeContents(outputDiv);
  selection.addRange(range);

  try {
    const success = document.execCommand('copy');
    if (success) {
      alert('Sanitized text copied to clipboard');
    } else {
      alert('Copy command was not successful');
    }
  } catch (err) {
    alert('Copy failed: ' + err);
  }

  // Optional: clear selection after copying
  selection.removeAllRanges();
});
