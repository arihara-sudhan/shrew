function normalizeText(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function inferTargetType(step = {}) {
  if (step.role === 'radio') return 'radio';
  if (step.action === 'fill' || step.totpFrom) return 'fill';
  if (step.action === 'click') return 'click';
  return 'generic';
}

async function buildRepairContext(page, step = {}, options = {}) {
  const maxCandidates = Number(options.maxCandidates || 50);
  const targetType = inferTargetType(step);

  return page.evaluate(({ step, maxCandidates, targetType }) => {
    function norm(value) {
      return (value || '').replace(/\s+/g, ' ').trim();
    }

    function cssEscapeSafe(value) {
      if (!value) return '';
      if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
      return value.replace(/([ #;?%&,.+*~\':"!^$[\]()=>|\/@])/g, '\\$1');
    }

    function isVisible(el) {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0;
    }

    function getElementText(el) {
      if (!el) return '';
      return norm(el.innerText || el.textContent || '');
    }

    function getAssociatedLabel(el) {
      if (!el) return '';
      if (el.id) {
        const label = document.querySelector(`label[for="${el.id}"]`);
        if (label) return getElementText(label);
      }
      const parentLabel = el.closest('label');
      return getElementText(parentLabel);
    }

    function getRole(el) {
      return el.getAttribute('role') || '';
    }

    function getNameForRole(el) {
      return norm(
        el.getAttribute('aria-label')
          || getAssociatedLabel(el)
          || el.getAttribute('placeholder')
          || el.getAttribute('name')
          || getElementText(el)
      );
    }

    function getNearbyText(el) {
      const container = el.closest('form, fieldset, section, article, div') || el.parentElement;
      return norm(container ? container.innerText || container.textContent || '' : '');
    }

    function isDecorativeSvg(el) {
      if ((el.tagName || '').toLowerCase() !== 'svg') return false;
      const text = getElementText(el);
      const ariaHidden = el.getAttribute('aria-hidden');
      return (!text && ariaHidden !== 'false') || ariaHidden === 'true';
    }

    function isGiantContainer(el) {
      const tag = (el.tagName || '').toLowerCase();
      const rect = el.getBoundingClientRect();
      return ['div', 'section', 'article', 'main'].includes(tag) && (rect.width > 500 || rect.height > 250);
    }

    function isUniquelyMatchable(selector) {
      if (!selector) return false;
      try {
        return document.querySelectorAll(selector).length === 1;
      } catch {
        return false;
      }
    }

    function getRoleSelector(el) {
      const role = getRole(el);
      const roleName = getNameForRole(el);
      if (!role) return '';
      return roleName ? `role=${role}[name='${roleName.replace(/'/g, "\\'")}']` : `role=${role}`;
    }

    function getBestUniqueSelector(el) {
      const tag = (el.tagName || '').toLowerCase();
      const selectors = [];

      if (el.id) selectors.push(`#${cssEscapeSafe(el.id)}`);

      if (el.getAttribute('name')) {
        selectors.push(`${tag}[name="${el.getAttribute('name')}"]`);
      }

      if (el.getAttribute('aria-label')) {
        selectors.push(`${tag}[aria-label="${el.getAttribute('aria-label')}"]`);
      }

      if (el.getAttribute('placeholder')) {
        selectors.push(`${tag}[placeholder="${el.getAttribute('placeholder')}"]`);
      }

      if (tag === 'input' && el.getAttribute('type') && el.getAttribute('value')) {
        selectors.push(`input[type="${el.getAttribute('type')}"][value="${el.getAttribute('value')}"]`);
      }

      const text = getElementText(el);
      if (tag === 'button' && text) {
        selectors.push(`button:has-text('${text.replace(/'/g, "\\'")}')`);
      }

      const label = getAssociatedLabel(el);
      if (label && ['input', 'textarea', 'select'].includes(tag) && el.id) {
        selectors.push(`#${cssEscapeSafe(el.id)}`);
      }

      for (const selector of selectors) {
        if (isUniquelyMatchable(selector)) return selector;
      }

      return selectors[0] || '';
    }

    function buildSelectors(el) {
      const selectors = [];
      const tag = (el.tagName || '').toLowerCase();
      const roleSelector = getRoleSelector(el);
      const bestSelector = getBestUniqueSelector(el);

      if (bestSelector) selectors.push(bestSelector);
      if (el.id) selectors.push(`#${cssEscapeSafe(el.id)}`);
      if (el.getAttribute('name')) selectors.push(`${tag}[name="${el.getAttribute('name')}"]`);
      if (el.getAttribute('aria-label')) selectors.push(`${tag}[aria-label="${el.getAttribute('aria-label')}"]`);
      if (el.getAttribute('placeholder')) selectors.push(`${tag}[placeholder="${el.getAttribute('placeholder')}"]`);
      if (tag === 'input' && el.getAttribute('type')) {
        selectors.push(`input[type="${el.getAttribute('type')}"]`);
      }
      if (roleSelector) {
        selectors.push(roleSelector);
      }
      if (tag === 'button') {
        const text = getElementText(el);
        if (text) selectors.push(`button:has-text('${text.replace(/'/g, "\\'")}')`);
      }
      if (tag === 'label') {
        const text = getElementText(el);
        if (text) selectors.push(`label:has-text('${text.replace(/'/g, "\\'")}')`);
      }

      return Array.from(new Set(selectors.filter(Boolean)));
    }

    function matchesTargetType(el) {
      const tag = (el.tagName || '').toLowerCase();
      const type = (el.getAttribute('type') || '').toLowerCase();
      const role = getRole(el);

      if (role === 'alert' || isDecorativeSvg(el) || isGiantContainer(el)) {
        return false;
      }

      if (targetType === 'click') {
        return tag === 'button'
          || tag === 'a'
          || type === 'button'
          || type === 'submit'
          || role === 'button'
          || role === 'link';
      }

      if (targetType === 'fill') {
        return ['input', 'textarea', 'select'].includes(tag)
          && !['hidden', 'radio', 'checkbox', 'submit', 'button'].includes(type);
      }

      if (targetType === 'radio') {
        return type === 'radio' || role === 'radio' || tag === 'label';
      }

      return ['input', 'textarea', 'select', 'button', 'a', 'label'].includes(tag) || ['button', 'link', 'radio'].includes(role);
    }

    const all = Array.from(document.querySelectorAll('input, textarea, select, button, a, label, [role], svg'))
      .filter((el) => isVisible(el))
      .filter((el) => matchesTargetType(el));

    const ranked = all
      .map((el, index) => {
        const rect = el.getBoundingClientRect();
        const text = getElementText(el);
        const label = getAssociatedLabel(el);
        const nearbyText = getNearbyText(el);
        const selectors = buildSelectors(el);

        return {
          tag: (el.tagName || '').toLowerCase(),
          type: el.getAttribute('type') || '',
          id: el.id || '',
          name: el.getAttribute('name') || '',
          role: getRole(el),
          placeholder: el.getAttribute('placeholder') || '',
          ariaLabel: el.getAttribute('aria-label') || '',
          text,
          label,
          nearbyText: nearbyText.slice(0, 300),
          outerHTML: (el.outerHTML || '').slice(0, 500),
          bestSelector: selectors[0] || '',
          selectors,
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
          order: index + 1,
        };
      })
      .filter((item) => item.selectors.length > 0)
      .slice(0, maxCandidates);

    const visibleText = norm(document.body ? document.body.innerText || document.body.textContent || '' : '')
      .slice(0, 1500);

    return {
      page: {
        title: document.title || '',
        url: window.location.href,
        visibleText,
      },
      step: {
        id: step.id || '',
        action: step.action || '',
        description: step.description || '',
        role: step.role || '',
        name: step.name || '',
        selector: step.selector || '',
        fallbackSelectors: Array.isArray(step.fallbackSelectors) ? step.fallbackSelectors : [],
      },
      targetType,
      candidates: ranked,
    };
  }, { step, maxCandidates, targetType });
}

function flattenSelectorsFromContext(repairContext) {
  return unique((repairContext?.candidates || []).flatMap((candidate) => candidate.selectors || []));
}

function summarizeRepairContext(repairContext) {
  if (!repairContext) return 'No repair context available.';

  const lines = [];
  lines.push(`Page title: ${normalizeText(repairContext.page?.title) || '(none)'}`);
  lines.push(`Page URL: ${normalizeText(repairContext.page?.url) || '(unknown)'}`);
  lines.push(`Visible text snippet: ${normalizeText(repairContext.page?.visibleText).slice(0, 500) || '(none)'}`);
  lines.push(`Step: ${JSON.stringify(repairContext.step || {})}`);
  lines.push(`Target type: ${repairContext.targetType || 'generic'}`);
  lines.push('Candidates:');

  for (const [index, candidate] of (repairContext.candidates || []).entries()) {
    lines.push(
      `${index + 1}. ${JSON.stringify({
        order: candidate.order,
        tag: candidate.tag,
        type: candidate.type,
        id: candidate.id,
        name: candidate.name,
        role: candidate.role,
        placeholder: candidate.placeholder,
        ariaLabel: candidate.ariaLabel,
        text: candidate.text,
        label: candidate.label,
        nearbyText: candidate.nearbyText,
        outerHTML: candidate.outerHTML,
        bestSelector: candidate.bestSelector,
        selectors: candidate.selectors,
      })}`
    );
  }

  return lines.join('\n');
}

function summarizeRepairContextForLog(repairContext, maxCandidates = 8) {
  if (!repairContext) return 'No repair context available.';

  const lines = [];
  lines.push(`Page title: ${normalizeText(repairContext.page?.title) || '(none)'}`);
  lines.push(`Page URL: ${normalizeText(repairContext.page?.url) || '(unknown)'}`);
  lines.push(`Step: ${JSON.stringify(repairContext.step || {})}`);
  lines.push(`Target type: ${repairContext.targetType || 'generic'}`);
  lines.push('Candidates:');

  for (const [index, candidate] of (repairContext.candidates || []).slice(0, maxCandidates).entries()) {
    lines.push(
      `${index + 1}. ${JSON.stringify({
        order: candidate.order,
        tag: candidate.tag,
        type: candidate.type,
        id: candidate.id,
        name: candidate.name,
        role: candidate.role,
        text: candidate.text,
        label: candidate.label,
        bestSelector: candidate.bestSelector,
        selectors: candidate.selectors.slice(0, 3),
      })}`
    );
  }

  return lines.join('\n');
}

module.exports = {
  buildRepairContext,
  flattenSelectorsFromContext,
  summarizeRepairContext,
  summarizeRepairContextForLog,
};
