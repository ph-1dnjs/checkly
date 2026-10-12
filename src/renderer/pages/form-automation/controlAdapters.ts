// Injected into the target page. Uses public DOM/ARIA and native events only;
// component styles, theme tokens and React implementation details are irrelevant.
export const controlAdapters = `
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const waitForControl = async (matches) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (matches()) return true;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return matches();
  };
  const classes = (element) => Array.from(element?.classList || []);
  const classRoot = (element, suffix) => {
    for (let node = element; node && node.tagName !== 'FORM'; node = node.parentElement) {
      if (classes(node).some((name) => name.endsWith('-' + suffix))) return node;
    }
    return null;
  };
  const choiceRootFor = (element) => element.closest('[data-scope="select"][data-part="root"], [data-scope="combobox"][data-part="root"]') || classRoot(element, 'select');
  const choiceControlFor = (element) => {
    const root = choiceRootFor(element);
    return root?.querySelector('[role="combobox"]') || (element.getAttribute('role') === 'combobox' && element.getAttribute('aria-haspopup') !== 'dialog' ? element : null);
  };
  const choiceSelectFor = (element) => choiceRootFor(element)?.querySelector('select') || null;
  const radioInputFor = (element) => element.matches('input[type="radio"]') ? element : element.closest('label, [data-scope="radio-group"][data-part="item"]')?.querySelector('input[type="radio"]');
  const radioValue = (element) => radioInputFor(element)?.value ?? element.getAttribute('data-value') ?? element.getAttribute('value') ?? '';
  const isRadio = (element) => element.matches('input[type="radio"], [role="radio"]');
  const activatableReadOnly = (element) => element instanceof HTMLTextAreaElement
    || (element instanceof HTMLInputElement && ['text', 'password', 'email', 'search', 'tel', 'url', 'number'].includes(element.type));
  const controlDisabled = (element, includeReadOnly = true) => Boolean(element.disabled || (includeReadOnly && element.readOnly) || element.getAttribute('aria-disabled') === 'true' || element.getAttribute('aria-readonly') === 'true'
    || element.closest('[data-disabled], [data-readonly], fieldset[disabled]')
    || classes(choiceRootFor(element)).some((name) => name.endsWith('-select-disabled')));
  const choiceDisabled = (element) => Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true' || element.getAttribute('aria-readonly') === 'true'
    || choiceRootFor(element)?.closest('[data-disabled], [data-readonly], fieldset[disabled]')
    || classes(choiceRootFor(element)).some((name) => name.endsWith('-select-disabled')));
  const canonicalControl = (element) => {
    const dateRoot = element.closest('[data-scope="date-picker"][data-part="root"]');
    const dateInputs = dateRoot?.querySelectorAll('input[data-part="input"]');
    if (dateInputs?.length === 1) return dateInputs[0];
    return choiceControlFor(element) || (isCheckbox(element) ? checkboxControlFor(element) : element.matches('[data-scope="radio-group"][data-part="item"]') ? (element.querySelector('[role="radio"], input[type="radio"]') || element) : element);
  };
  const checkboxGroupFor = (element) => element.closest('[data-scope="checkbox"][data-part="group"]') || classRoot(element, 'checkbox-group');
  const choiceMultiple = (element) => Boolean(choiceSelectFor(element)?.multiple || element.getAttribute('data-qa-autofill-type') === 'select-multiple'
    || classes(choiceRootFor(element)).some((name) => name.endsWith('-select-multiple')));
  const keyEvent = (element, key) => {
    const code = { ArrowDown: 40, ArrowUp: 38, Enter: 13, Escape: 27 }[key] || 0;
    for (const type of ['keydown', 'keyup']) element.dispatchEvent(new KeyboardEvent(type, { key, code: key, keyCode: code, which: code, bubbles: true, composed: true, cancelable: true }));
  };
  const choiceList = (element) => {
    for (const id of (element.getAttribute('aria-controls') || element.getAttribute('aria-owns') || '').split(/\\s+/)) {
      const controlled = document.getElementById(id);
      if (controlled) return controlled;
    }
    return choiceRootFor(element)?.querySelector('[role="listbox"]') || null;
  };
  const openChoice = async (element) => {
    if (element.getAttribute('aria-expanded') !== 'true') {
      element.focus({ preventScroll: true });
      keyEvent(element, 'ArrowDown');
    }
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (choiceList(element)?.querySelector('[role="option"]') && element.getAttribute('aria-expanded') === 'true') return true;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return false;
  };
  const closeChoice = async (element) => {
    keyEvent(element, 'Escape');
    // Ark restores input focus on the next animation frame after closing.
    // Finish that restoration before opening another library's popup.
    await new Promise((resolve) => {
      // Background webviews may pause animation frames. Keep replay bounded.
      const timeout = setTimeout(resolve, 80);
      requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timeout); resolve(); }));
    });
    element.blur(); await settle();
  };
  const optionRecords = (element) => Array.from(choiceList(element)?.querySelectorAll('[role="option"]') || []).map((option) => {
    const label = String(option.getAttribute('aria-label') || option.querySelector('[data-part="item-text"]')?.textContent || option.textContent || '').trim();
    const value = option.getAttribute('data-value') ?? option.getAttribute('value') ?? String(option.textContent || '').trim();
    // Ant Design's virtualized list exposes values in a separate ARIA list.
    // Disabled styling is on the corresponding visible option in v5.
    const popup = classRoot(choiceList(element), 'select-dropdown');
    const disabledVisual = Array.from(popup?.querySelectorAll('[class]') || []).some((node) => classes(node).some((name) => name.endsWith('-item-option-disabled')) && String(node.getAttribute('title') || node.textContent || '').trim() === label);
    return { value, label, disabled: option.getAttribute('aria-disabled') === 'true' || option.hasAttribute('data-disabled') || disabledVisual, selected: option.getAttribute('aria-selected') === 'true', id: option.id };
  });
  const activeOption = (element) => document.getElementById(element.getAttribute('aria-activedescendant') || '');
  const collectChoiceOptions = async (element) => {
    const select = choiceSelectFor(element);
    if (select) return Array.from(select.options).filter((option) => option.value !== '').map((option) => ({ value: option.value, label: String(option.textContent || '').trim(), disabled: option.disabled, selected: option.selected }));
    if (!await openChoice(element)) return [];
    const result = new Map(); const visited = new Set();
    for (let attempt = 0; attempt < 200; attempt += 1) {
      await settle();
      optionRecords(element).forEach((option) => result.set(option.value, option));
      const active = element.getAttribute('aria-activedescendant');
      if (active && visited.has(active)) break;
      if (active) visited.add(active);
      const before = active;
      keyEvent(element, 'ArrowDown');
      await settle();
      if (element.getAttribute('aria-activedescendant') === before) break;
    }
    return Array.from(result.values());
  };
  const activateChoiceOption = async (element, value) => {
    if (!await openChoice(element)) return false;
    const visited = new Set();
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const active = activeOption(element);
      const option = optionRecords(element).find((record) => record.id === active?.id);
      if (option?.value === value) {
        if (option.disabled) return false;
        keyEvent(element, 'Enter'); await settle(); return true;
      }
      const id = active?.id;
      if (id && visited.has(id)) break;
      if (id) visited.add(id);
      keyEvent(element, 'ArrowDown'); await settle();
    }
    return false;
  };
  const setChoice = async (element, value) => {
    const requested = (Array.isArray(value) ? value : value == null || value === '' ? [] : [value]).map(String);
    const multiple = choiceMultiple(element);
    if (!multiple && requested.length > 1) return false;
    const options = await collectChoiceOptions(element);
    const targets = requested.map((value) => options.find((option) => option.value === value && !option.disabled));
    if (targets.some((option) => !option)) { await closeChoice(element); return false; }
    const desired = targets.map((option) => option.value);
    const select = choiceSelectFor(element);
    if (select) {
      if (select.multiple) Array.from(select.options).forEach((option) => { option.selected = desired.includes(option.value); });
      else nativeSet(select, 'value', desired[0] || '');
      select.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      select.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      await settle();
      return JSON.stringify(Array.from(select.selectedOptions).map((option) => option.value).filter(Boolean).sort()) === JSON.stringify([...desired].sort());
    }
    if (!desired.length && !multiple) {
      const root = choiceRootFor(element);
      const clear = root?.querySelector('[data-part="clear-trigger"]') || Array.from(root?.querySelectorAll('[class]') || []).find((node) => classes(node).some((name) => name.endsWith('-select-clear')));
      if (!options.some((option) => option.selected)) { await closeChoice(element); return true; }
      if (!clear) { await closeChoice(element); return false; }
      clear.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })); clear.click(); await settle();
    } else {
      const changes = multiple ? options.filter((option) => option.selected !== desired.includes(option.value)) : targets.filter((option) => !option.selected);
      for (const option of changes) if (!await activateChoiceOption(element, option.value)) { await closeChoice(element); return false; }
    }
    const finalOptions = await collectChoiceOptions(element);
    const selected = finalOptions.filter((option) => option.selected).map((option) => option.value).sort();
    await closeChoice(element);
    return JSON.stringify(selected) === JSON.stringify([...desired].sort());
  };
  const setRadio = async (elements, value) => {
    const target = elements.find((element) => String(radioValue(element)) === String(value));
    if (!target || controlDisabled(target)) return false;
    const checked = () => target instanceof HTMLInputElement ? target.checked : target.getAttribute('aria-checked') === 'true';
    if (!checked()) { target.click(); await settle(); }
    target.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true }));
    return checked();
  };
  const setTextControl = async (element, value) => {
    element.focus({ preventScroll: true });
    if (element.readOnly) await waitForControl(() => !element.readOnly);
    if (controlDisabled(element)) return false;
    const picker = classRoot(element, 'picker') || element.closest('[data-scope="date-picker"][data-part="root"]');
    if (picker && value === '' && element.value) {
      const clear = picker.querySelector('[data-part="clear-trigger"]') || Array.from(picker.querySelectorAll('[class]')).find((node) => classes(node).some((name) => name.endsWith('-picker-clear')));
      if (clear) { clear.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); clear.click(); return await waitForControl(() => !element.value); }
    }
    element.focus({ preventScroll: true });
    nativeSet(element, 'value', String(value ?? ''));
    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    await settle();
    if (picker) { keyEvent(element, 'Enter'); await settle(); }
    element.blur();
    element.dispatchEvent(new FocusEvent('blur', { bubbles: true, composed: true }));
    element.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true }));
    await settle();
    return String(element.value ?? '') === String(value ?? '');
  };
`;
