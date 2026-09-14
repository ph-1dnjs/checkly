import type { FieldValue } from "./model";

export const discoverFieldsScript = `(() => {
  const visible = (element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], dialog[open], [aria-modal="true"]')).filter(visible);
  const root = dialogs.at(-1) || document;
  const candidates = Array.from(root.querySelectorAll('input, textarea, select, [contenteditable="true"], [role="radio"][id], button, [role="button"]'));
  const ignored = new Set(['hidden', 'submit', 'button', 'reset', 'image']);
  const groups = new Map();
  const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
  const labelNameMap = new Map([
    ['공개 여부', 'isPublic'], ['내용', 'content'], ['제목', 'title'], ['이메일', 'email'], ['비밀번호', 'password'],
    ['이름', 'name'], ['담당자', 'manager'], ['전화번호', 'phone'], ['휴대폰', 'mobile'], ['설명', 'description'],
    ['답변 등록', 'answer'], ['답변', 'answer'], ['소명 내용', 'answer'],
  ]);
  const nearbyStructuralLabel = (element) => {
    let current = element;
    for (let depth = 0; depth < 4 && current?.parentElement; depth += 1) {
      const parent = current.parentElement;
      const siblings = Array.from(parent.children);
      const index = siblings.indexOf(current);
      for (let siblingIndex = index - 1; siblingIndex >= 0; siblingIndex -= 1) {
        const sibling = siblings[siblingIndex];
        if (sibling.querySelector?.('input, textarea, select, [contenteditable="true"]')) continue;
        const text = clean(sibling.textContent);
        if (text && text.length <= 40) return text.replace(/\\s*\\*$/, '');
      }
      current = parent;
    }
    return '';
  };
  const labelFor = (element) => {
    const formLabel = element.closest('[data-slot="form-item"]')?.querySelector('[data-slot="form-label"]')?.textContent || '';
    const labelledBy = element.getAttribute('aria-labelledby');
    const ariaLabelled = labelledBy ? labelledBy.split(/\\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ') : '';
    const wrappingLabel = element.closest('label')?.textContent || '';
    const previousLabel = element.parentElement?.querySelector(':scope > label')?.textContent || '';
    const isButton = element instanceof HTMLButtonElement || element.getAttribute('role') === 'button';
    const buttonText = isButton ? element.textContent : '';
    return clean(formLabel || element.labels?.[0]?.textContent || element.getAttribute('aria-label') || ariaLabelled || wrappingLabel || previousLabel || buttonText || nearbyStructuralLabel(element) || element.getAttribute('placeholder') || element.name || element.textContent).replace(/\\s*\\*$/, '');
  };
  const searchHeadings = Array.from(root.querySelectorAll('h1, h2, h3, h4, legend, [role="heading"]')).filter((element) => /검색|필터|search|filter/i.test(clean(element.textContent)));
  const belongsToSearchArea = (element, fieldName, label) => {
    if (element.closest('[role="grid"], table')) return false;
    if (element.closest('[role="search"], [class*="search" i], [class*="filter" i], [id*="search" i], [id*="filter" i], [data-testid*="search" i], [data-testid*="filter" i]')) return true;
    if (/search|filter|keyword|검색|필터|검색어/i.test(String(fieldName) + ' ' + String(label))) return true;
    return searchHeadings.some((heading) => {
      const headingRect = heading.getBoundingClientRect();
      const fieldRect = element.getBoundingClientRect();
      if (fieldRect.top < headingRect.bottom || fieldRect.top - headingRect.bottom > 280) return false;
      let container = heading.parentElement;
      while (container && container !== document.body && !container.contains(element)) container = container.parentElement;
      return Boolean(container && container !== document.body);
    });
  };
  candidates.forEach((element, candidateIndex) => {
    const role = element.getAttribute('role');
    const candidateText = clean(element.getAttribute('aria-label') || element.getAttribute('placeholder') || element.textContent);
    const structuralLabel = nearbyStructuralLabel(element);
    const opensDialog = element.getAttribute('aria-haspopup') === 'dialog' || element.getAttribute('data-state') != null;
    const dateTrigger = element.getAttribute('data-qa-autofill-type') === 'date-trigger' || ((element instanceof HTMLButtonElement || role === 'button') && (/날짜|기간|시작일|종료일|date|calendar/i.test(candidateText) || (opensDialog && /일자|일|기간|date/i.test(structuralLabel))));
    const type = dateTrigger ? 'date-trigger' : element.isContentEditable ? 'contenteditable' : role === 'radio' ? 'radio' : (element.type || element.tagName.toLowerCase());
    const formId = element.closest('form')?.id || '';
    const label = dateTrigger ? clean(structuralLabel || labelFor(element)) : labelFor(element);
    const rawId = element.id && formId && element.id.startsWith(formId + '-') ? element.id.slice(formId.length + 1).replace(/-\\d+$/, '') : '';
    const labelKey = label.replace(/\\s*\\*$/, '');
    let fieldName = element.name || element.getAttribute('data-name') || element.getAttribute('data-field-name') || (dateTrigger ? '' : element.getAttribute('data-qa-autofill-name')) || rawId || labelNameMap.get(labelKey) || labelKey || ('qaField' + (candidateIndex + 1));
    const meaningfulFile = type === 'file' && Boolean(element.name || rawId || element.id) && !element.classList.contains('ck-hidden') && !element.closest('.ck-editor');
    const searchField = belongsToSearchArea(element, fieldName, label);
    const plainInput = (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) && !element.closest('[role="grid"], table');
    const hasFormContext = Boolean(element.name || element.closest('form, [data-slot="form-item"]') || element.isContentEditable || role === 'radio' || meaningfulFile || searchField || plainInput || dateTrigger);
    if (!fieldName || !hasFormContext || ignored.has(type) || element.disabled || element.readOnly || (!visible(element) && !meaningfulFile)) return;
    if (groups.has(fieldName) && type !== 'radio' && type !== 'checkbox') fieldName = fieldName + '__' + (candidateIndex + 1);
    element.setAttribute('data-qa-autofill-name', fieldName);
    element.setAttribute('data-qa-autofill-type', type);
    const existing = groups.get(fieldName);
    const options = type === 'radio'
      ? [{ value: element.value, label: clean(element.parentElement?.querySelector('label')?.textContent || element.value), disabled: element.disabled }]
      : element instanceof HTMLSelectElement
        ? Array.from(element.options).map((option) => ({ value: option.value, label: clean(option.textContent), disabled: option.disabled }))
        : [];
    if (existing) {
      if (type === 'radio') existing.options.push(...options);
      existing.required = existing.required || element.required || element.getAttribute('aria-required') === 'true' || label.includes('*');
      return;
    }
    groups.set(fieldName, {
      name: fieldName,
      label,
      type,
      required: Boolean(element.required || element.getAttribute('aria-required') === 'true' || element.closest('[data-slot="form-item"]')?.querySelector('[data-slot="form-label"]')?.textContent?.includes('*')),
      placeholder: clean(element.getAttribute('placeholder') || element.querySelector?.('[data-placeholder]')?.getAttribute('data-placeholder')),
      minLength: Number(element.minLength) > 0 ? Number(element.minLength) : 0,
      maxLength: Number(element.maxLength) > 0 ? Number(element.maxLength) : 0,
      min: element.getAttribute('min') || '', max: element.getAttribute('max') || '', pattern: element.getAttribute('pattern') || '',
      accept: type === 'file' ? element.getAttribute('accept') || '' : '',
      multiple: type === 'file' && Boolean(element.multiple),
      context: searchField ? 'search' : 'form',
      options,
    });
  });
  return Array.from(groups.values());
})()`;

export const fillFieldsScript = (fields: Record<string, FieldValue>): string => `(() => {
  const fields = ${JSON.stringify(fields)};
  const filled = []; const missing = []; const richText = []; const fileInputs = []; const dateTriggers = [];
  const visible = (element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], dialog[open], [aria-modal="true"]')).filter(visible);
  const scope = dialogs.at(-1) || document;
  const elementsFor = (key) => Array.from(scope.querySelectorAll('[data-qa-autofill-name], [name], [data-name], [data-field-name]')).filter((element) => !element.disabled && (element.getAttribute('data-qa-autofill-name') === key || element.getAttribute('name') === key || element.getAttribute('data-name') === key || element.getAttribute('data-field-name') === key));
  const nativeSet = (element, property, value) => {
    const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : Object.getPrototypeOf(element);
    const setter = Object.getOwnPropertyDescriptor(prototype, property)?.set;
    if (setter) setter.call(element, value); else element[property] = value;
  };
  const notify = (element) => {
    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    element.dispatchEvent(new FocusEvent('blur', { bubbles: true, composed: true }));
    element.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true }));
  };
  Object.entries(fields).forEach(([key, value]) => {
    const elements = elementsFor(key);
    if (!elements.length) { missing.push(key); return; }
    const first = elements[0];
    if (first.getAttribute('data-qa-autofill-type') === 'date-trigger') dateTriggers.push({ key, value });
    else if (first.type === 'file') {
      const token = 'qa-file-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      first.setAttribute('data-qa-file-token', token);
      const config = value && typeof value === 'object' ? value : { valid: true, accept: first.accept || '', multiple: first.multiple };
      fileInputs.push({ key, token, valid: config.valid !== false, accept: config.accept || first.accept || '', multiple: Boolean(config.multiple || first.multiple) });
    } else if (first.type === 'radio' || first.getAttribute('role') === 'radio') {
      if (value !== null && value !== undefined) elements.forEach((element) => {
        const checked = String(element.value) === String(value);
        if (element.getAttribute('role') === 'radio') { if (checked && element.getAttribute('aria-checked') !== 'true') element.click(); }
        else { nativeSet(element, 'checked', checked); notify(element); }
      });
    } else if (first.type === 'checkbox') elements.forEach((element) => { nativeSet(element, 'checked', Array.isArray(value) ? value.map(String).includes(String(element.value)) : Boolean(value)); notify(element); });
    else if (first instanceof HTMLSelectElement && first.multiple) { const selected = Array.isArray(value) ? value.map(String) : [String(value ?? '')]; Array.from(first.options).forEach((option) => { option.selected = selected.includes(String(option.value)); }); notify(first); }
    else if (first.isContentEditable) richText.push({ key, value: String(value ?? '') });
    else { nativeSet(first, 'value', String(value ?? '')); notify(first); }
    filled.push(key);
  });
  return { filled, missing, richText, fileInputs, dateTriggers };
})()`;

export const clearFieldsScript = (keys: string[]): string => `(() => {
  const keys = ${JSON.stringify(keys)};
  const cleared = []; const missing = [];
  const visible = (element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], dialog[open], [aria-modal="true"]')).filter(visible);
  const scope = dialogs.at(-1) || document;
  const elementsFor = (key) => Array.from(scope.querySelectorAll('[data-qa-autofill-name], [name], [data-name], [data-field-name]')).filter((element) => !element.disabled && (element.getAttribute('data-qa-autofill-name') === key || element.getAttribute('name') === key || element.getAttribute('data-name') === key || element.getAttribute('data-field-name') === key));
  const hasDateTrigger = keys.some((key) => elementsFor(key).some((element) => element.getAttribute('data-qa-autofill-type') === 'date-trigger'));
  const pageResetButton = hasDateTrigger ? Array.from(scope.querySelectorAll('button, [role="button"]')).filter(visible).find((element) => /^(초기화|reset)$/i.test(String(element.textContent || '').trim())) : null;
  if (pageResetButton) pageResetButton.click();
  const nativeSet = (element, property, value) => {
    const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : Object.getPrototypeOf(element);
    const setter = Object.getOwnPropertyDescriptor(prototype, property)?.set;
    if (setter) setter.call(element, value); else element[property] = value;
  };
  const notify = (element) => { element.dispatchEvent(new Event('input', { bubbles: true, composed: true })); element.dispatchEvent(new Event('change', { bubbles: true, composed: true })); element.dispatchEvent(new FocusEvent('blur', { bubbles: true, composed: true })); element.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true })); };
  const radioText = (element) => String(element.closest('label')?.textContent || element.parentElement?.textContent || '').replace(/\\s+/g, ' ').trim();
  keys.forEach((key) => {
    const elements = elementsFor(key);
    if (!elements.length) { missing.push(key); return; }
    const first = elements[0];
    if (first.getAttribute('data-qa-autofill-type') === 'date-trigger') { if (!pageResetButton) missing.push(key + '(초기화 버튼 없음)'); else cleared.push(key); return; }
    if (first.type === 'radio' || first.getAttribute('role') === 'radio') {
      const preferred = elements.find((element) => /^(all|전체)?$/i.test(String(element.value || '')) || /전체/.test(radioText(element)));
      elements.forEach((element) => { const checked = element === preferred; if (element.getAttribute('role') === 'radio') { if (checked && element.getAttribute('aria-checked') !== 'true') element.click(); } else { nativeSet(element, 'checked', checked); notify(element); } });
    } else if (first.type === 'checkbox') elements.forEach((element) => { nativeSet(element, 'checked', false); notify(element); });
    else if (first instanceof HTMLSelectElement) { if (first.multiple) Array.from(first.options).forEach((option) => { option.selected = false; }); else nativeSet(first, 'value', Array.from(first.options).find((option) => !option.disabled)?.value || ''); notify(first); }
    else if (first.isContentEditable) { first.focus(); first.textContent = ''; notify(first); }
    else { nativeSet(first, 'value', ''); notify(first); }
    cleared.push(key);
  });
  return { cleared, missing };
})()`;

export const focusRichTextScript = (key: string): string => `(() => {
  const key = ${JSON.stringify(key)};
  const visible = (candidate) => candidate.getClientRects().length > 0 && getComputedStyle(candidate).visibility !== 'hidden';
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], dialog[open], [aria-modal="true"]')).filter(visible);
  const scope = dialogs.at(-1) || document;
  const element = Array.from(scope.querySelectorAll('[data-qa-autofill-name]')).find((candidate) => candidate.getAttribute('data-qa-autofill-name') === key && candidate.isContentEditable);
  if (!element) return false;
  element.focus();
  const selection = getSelection(); const range = document.createRange();
  range.selectNodeContents(element); selection.removeAllRanges(); selection.addRange(range);
  return true;
})()`;

export const selectDateRangeScript = (key: string, value: FieldValue): string => `(async () => {
  const key = ${JSON.stringify(key)}; const value = ${JSON.stringify(value)};
  const visible = (element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
  const trigger = Array.from(document.querySelectorAll('[data-qa-autofill-name]')).find((candidate) => candidate.getAttribute('data-qa-autofill-name') === key && candidate.getAttribute('data-qa-autofill-type') === 'date-trigger' && visible(candidate));
  if (!trigger) return { selected: 0, expected: 1 };
  const sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration));
  const popupFor = () => Array.from(document.querySelectorAll('[role="dialog"], [data-radix-popper-content-wrapper], [data-state="open"], [class*="calendar" i], [class*="datepicker" i]')).filter(visible).findLast((candidate) => candidate.matches('[class*="calendar" i], [class*="datepicker" i]') || candidate.querySelector('[role="grid"], [aria-label*="month" i], [aria-label*="월"]')) || null;
  const ensurePopup = async () => { const open = popupFor(); if (open) return open; trigger.click(); await sleep(180); return popupFor(); };
  const dateParts = (iso) => { const [year, month, day] = String(iso || '').split('-').map(Number); return { year, month, day, iso: String(iso || ''), dotted: [year, String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('.'), monthIndex: year * 12 + month - 1 }; };
  const buttons = (popup) => Array.from((popup || document).querySelectorAll('button, [role="gridcell"], [role="button"]')).filter((element) => visible(element) && !element.disabled && element.getAttribute('aria-disabled') !== 'true');
  const findDate = (popup, iso) => { const target = dateParts(iso); return buttons(popup).find((element) => { const signal = [element.getAttribute('data-day'), element.getAttribute('data-date'), element.getAttribute('datetime'), element.getAttribute('aria-label'), element.getAttribute('title'), element.getAttribute('value')].filter(Boolean).join(' '); return signal.includes(target.iso) || signal.includes(target.dotted) || signal.includes(target.year + '년 ' + target.month + '월 ' + target.day + '일'); }); };
  const visibleMonth = (popup) => { const text = Array.from((popup || document).querySelectorAll('[role="status"], [aria-live], [class*="caption" i], [class*="month" i]')).map((element) => String(element.textContent || '').trim()).find((entry) => /\\d{4}년\\s*\\d{1,2}월/.test(entry) || /[A-Za-z]+\\s+\\d{4}/.test(entry)); const korean = text?.match(/(\\d{4})년\\s*(\\d{1,2})월/); if (korean) return Number(korean[1]) * 12 + Number(korean[2]) - 1; const english = text ? new Date('1 ' + text) : null; return english && !Number.isNaN(english.getTime()) ? english.getFullYear() * 12 + english.getMonth() : null; };
  const navigation = (popup, direction) => buttons(popup).find((element) => { const text = [element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent].filter(Boolean).join(' '); return direction < 0 ? /previous month|prev month|이전 달|이전달/i.test(text) : /next month|다음 달|다음달/i.test(text); });
  const select = async (iso) => { const target = dateParts(iso); if (!target.year || !target.month || !target.day) return false; let popup = await ensurePopup(); if (!popup) return false; for (let attempt = 0; attempt < 24; attempt += 1) { const exact = findDate(popup, iso); const current = visibleMonth(popup); if (exact && (current === null || current === target.monthIndex)) { exact.click(); await sleep(100); return true; } if (current === null || current === target.monthIndex) return false; const next = navigation(popup, target.monthIndex < current ? -1 : 1); if (!next) return false; next.click(); await sleep(120); popup = popupFor() || popup; } return false; };
  const targets = (value?.__qaDateRange ? [value.start, value.end] : [String(value || '')]).filter(Boolean);
  let selected = 0; for (const target of targets) if (await select(target)) selected += 1;
  const apply = Array.from(document.querySelectorAll('button')).filter(visible).find((element) => /^(적용|확인|선택|완료|apply|confirm|done)$/i.test(String(element.textContent || '').trim()));
  if (apply) apply.click();
  return { selected, expected: targets.length };
})()`;
