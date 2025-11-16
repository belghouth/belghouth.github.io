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
};

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

  text = text
    .replace(/\s*\u2014\s*/g, '; ')
    .replace(/;\s+/g, '; ');  // ensure exactly one space after ;

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

  return cleanedHtml;
}

// --- Events -----------------------------------------------------

sanitizeBtn.addEventListener('click', () => {
  const html = quill.root.innerHTML;
  const cleanedHtml = sanitizeHtmlPreservingFormatting(html, options);
  outputDiv.innerHTML = cleanedHtml;
});

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
