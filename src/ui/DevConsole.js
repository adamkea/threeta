/**
 * Drop-down developer console for tweaking the game while testing. Toggle with the backtick (`)
 * key; Escape also closes it. Commands are registered with `register(name, help, fn)`; `fn`
 * receives the whitespace-split arguments and may return a string to print.
 */
export class DevConsole {
  /** @param {{ onOpen?: () => void }} [opts] */
  constructor({ onOpen } = {}) {
    this.commands = new Map();
    this.history = [];
    this.historyPos = 0;
    this.onOpen = onOpen;

    this.el = document.createElement('div');
    this.el.id = 'console';
    this.el.innerHTML = '<div class="log"></div><form><span>&gt;</span><input type="text" spellcheck="false" autocomplete="off" /></form>';
    document.body.appendChild(this.el);
    this.logEl = this.el.querySelector('.log');
    this.field = this.el.querySelector('input');

    this.el.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const line = this.field.value.trim();
      this.field.value = '';
      if (line) this.exec(line);
    });
    this.field.addEventListener('keydown', (e) => {
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        e.preventDefault();
        if (!this.history.length) return;
        this.historyPos = Math.max(0, Math.min(this.history.length, this.historyPos + (e.code === 'ArrowUp' ? -1 : 1)));
        this.field.value = this.history[this.historyPos] ?? '';
      } else if (e.code === 'Tab') {
        e.preventDefault();
        this.complete();
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Backquote') {
        e.preventDefault();
        this.toggle();
      } else if (e.code === 'Escape' && this.isOpen) {
        e.preventDefault();
        this.close();
      }
    });

    this.register('help', 'list commands', () =>
      [...this.commands].map(([name, c]) => `${name.padEnd(8)} ${c.help}`).join('\n'),
    );
    this.register('cls', 'clear the console', () => {
      this.logEl.textContent = '';
    });
    this.print('Dev console — type "help" for commands. ` or Esc to close.', 'info');
  }

  get isOpen() {
    return this.el.classList.contains('open');
  }

  register(name, help, fn) {
    this.commands.set(name, { help, fn });
  }

  open() {
    this.el.classList.add('open');
    this.onOpen?.();
    this.field.focus();
  }

  close() {
    this.el.classList.remove('open');
    this.field.blur();
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  print(text, kind = '') {
    const line = document.createElement('div');
    line.className = kind;
    line.textContent = text;
    this.logEl.appendChild(line);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  exec(line) {
    this.history.push(line);
    this.historyPos = this.history.length;
    this.print(`> ${line}`, 'cmd');
    const [name, ...args] = line.split(/\s+/);
    const cmd = this.commands.get(name.toLowerCase());
    if (!cmd) return this.print(`Unknown command "${name}". Type "help".`, 'error');
    try {
      const out = cmd.fn(args.map((a) => a.toLowerCase()));
      if (out) this.print(out);
    } catch (err) {
      this.print(err.message, 'error');
    }
  }

  /** Tab-complete the command name. */
  complete() {
    const v = this.field.value;
    if (/\s/.test(v)) return;
    const hits = [...this.commands.keys()].filter((n) => n.startsWith(v.toLowerCase()));
    if (hits.length === 1) this.field.value = `${hits[0]} `;
    else if (hits.length > 1) this.print(hits.join('  '), 'info');
  }
}
