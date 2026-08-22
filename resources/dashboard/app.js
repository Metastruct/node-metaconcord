(() => {
	"use strict";

	const $ = sel => document.querySelector(sel);
	const logEl = $("#log");
	const modeBtn = $("#mode");
	const inputBar = $("#input-bar");
	const inputEl = $("#input");
	const levelFilter = $("#level-filter");
	const textFilter = $("#text-filter");
	const pauseBtn = $("#pause");
	const configsEl = $("#configs");

	const LEVELS = { 10: "trace", 20: "debug", 30: "info", 40: "warn", 50: "error", 60: "fatal" };
	const MAX_LINES = 3000;

	let mode = "js";
	let paused = false;
	const HISTORY_KEY = "metaconcord.history";
	let history = [];
	try {
		history = JSON.parse(sessionStorage.getItem(HISTORY_KEY) || "[]");
	} catch {
		history = [];
	}
	let historyIndex = history.length;
	let draft = "";

	// #region log pane

	const fmtTime = t => {
		const d = new Date(t);
		return d.toTimeString().slice(0, 8) + "." + String(d.getMilliseconds()).padStart(3, "0");
	};

	const el = (tag, cls, text) => {
		const node = document.createElement(tag);
		if (cls) node.className = cls;
		if (text !== undefined) node.textContent = text;
		return node;
	};

	const atBottom = () => logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 24;

	const append = node => {
		const stick = !paused && atBottom();
		logEl.appendChild(node);
		while (logEl.childElementCount > MAX_LINES) logEl.removeChild(logEl.firstChild);
		if (stick) logEl.scrollTop = logEl.scrollHeight;
	};

	/** Renders a raw process line: pino JSON if it parses, plain text otherwise. */
	const renderLog = ({ t, stream, line }) => {
		let json;
		if (line[0] === "{") {
			try {
				json = JSON.parse(line);
			} catch {
				json = undefined;
			}
		}
		const row = el("div", "line " + stream);
		row.dataset.text = line.toLowerCase();
		if (json && typeof json.level === "number") {
			row.classList.add("lvl-" + json.level);
			row.dataset.level = json.level;
			row.appendChild(el("span", "time", fmtTime(json.time || t)));
			row.appendChild(el("span", "lvl", LEVELS[json.level] || json.level));
			if (json.file) row.appendChild(el("span", "file", json.file));
			const msg = el("span", "msg", json.msg || "");
			const rest = { ...json };
			for (const k of ["level", "time", "pid", "hostname", "file", "msg"]) delete rest[k];
			if (rest.req && rest.res) {
				// pino-http access log: one line instead of the whole request dump
				msg.textContent = `${rest.req.method} ${rest.req.url} ${rest.res.statusCode} ${rest.responseTime}ms`;
				delete rest.req;
				delete rest.res;
				delete rest.responseTime;
			}
			if (rest.err && rest.err.stack) {
				msg.textContent += (msg.textContent ? "\n" : "") + rest.err.stack;
				delete rest.err;
			}
			if (Object.keys(rest).length) {
				msg.appendChild(el("span", "extra", " " + JSON.stringify(rest)));
			}
			row.appendChild(msg);
		} else {
			row.dataset.level = stream === "stderr" ? 50 : 30;
			row.appendChild(el("span", "time", fmtTime(t)));
			row.appendChild(el("span", "msg", line));
		}
		applyFilter(row);
		append(row);
	};

	const renderOut = (cls, text) => {
		const row = el("div", "line " + cls, text);
		row.dataset.level = 30;
		row.dataset.text = text.toLowerCase();
		applyFilter(row);
		append(row);
	};

	const applyFilter = row => {
		const minLevel = Number(levelFilter.value);
		const needle = textFilter.value.trim().toLowerCase();
		const ok =
			Number(row.dataset.level || 30) >= minLevel &&
			(!needle || (row.dataset.text || "").includes(needle));
		row.style.display = ok ? "" : "none";
	};

	const refilter = () => {
		for (const row of logEl.children) applyFilter(row);
		if (!paused) logEl.scrollTop = logEl.scrollHeight;
	};
	levelFilter.addEventListener("change", refilter);
	textFilter.addEventListener("input", refilter);

	pauseBtn.addEventListener("click", () => {
		paused = !paused;
		pauseBtn.textContent = paused ? "Resume" : "Pause";
		pauseBtn.classList.toggle("active", paused);
		if (!paused) logEl.scrollTop = logEl.scrollHeight;
	});
	$("#clear").addEventListener("click", () => (logEl.textContent = ""));
	logEl.addEventListener("click", () => {
		if (!getSelection().toString()) inputEl.focus();
	});

	// #endregion

	// #region websocket

	let ws;
	let retry = 0;

	const setStatus = state => {
		inputBar.dataset.state = state;
	};

	const connect = async () => {
		setStatus("connecting");
		try {
			const res = await fetch("/dashboard/logs?limit=500", { credentials: "same-origin" });
			if (res.status === 401) {
				location.href = "/";
				return;
			}
			logEl.textContent = "";
			for (const line of await res.json()) renderLog(line);
			renderOut("meta", "--- live ---");
		} catch (err) {
			renderOut("error", "backlog fetch failed: " + err.message);
		}

		const proto = location.protocol === "https:" ? "wss:" : "ws:";
		ws = new WebSocket(`${proto}//${location.host}/dashboard/ws`);
		ws.addEventListener("open", () => {
			retry = 0;
			setStatus("open");
		});
		ws.addEventListener("message", ev => {
			let msg;
			try {
				msg = JSON.parse(ev.data);
			} catch {
				return;
			}
			if (msg.type === "log") renderLog(msg);
			else if (msg.type === "out") renderOut(msg.mode, msg.text.replace(/\n$/, ""));
			else if (msg.type === "exit") renderOut("meta", `bash exited with code ${msg.code}`);
		});
		ws.addEventListener("close", () => {
			setStatus("closed");
			const delay = Math.min(30000, 1000 * 2 ** retry++);
			renderOut("meta", `disconnected, retrying in ${Math.round(delay / 1000)}s`);
			setTimeout(connect, delay);
		});
	};

	const send = data => {
		if (!ws || ws.readyState !== WebSocket.OPEN) {
			renderOut("error", "not connected");
			return false;
		}
		ws.send(JSON.stringify(data));
		return true;
	};

	// #endregion

	// #region input

	const setMode = next => {
		mode = next;
		modeBtn.dataset.mode = mode;
		modeBtn.textContent = mode === "js" ? "REPL" : "BASH";
		inputEl.placeholder = mode === "js" ? "MetaConcord.container.getServices()" : "ls config";
		inputEl.focus();
	};
	modeBtn.addEventListener("click", () => setMode(mode === "js" ? "bash" : "js"));

	inputBar.addEventListener("submit", ev => {
		ev.preventDefault();
		const value = inputEl.value;
		if (!value.trim()) return;
		renderOut("cmd", (mode === "js" ? "> " : "$ ") + value);
		const ok = send(
			mode === "js" ? { type: "js", code: value } : { type: "bash", input: value }
		);
		if (!ok) return;
		if (history[history.length - 1] !== value) history.push(value);
		if (history.length > 200) history.shift();
		historyIndex = history.length;
		try {
			sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history));
		} catch {
			// storage unavailable, history stays in memory
		}
		inputEl.value = "";
	});

	inputEl.addEventListener("keydown", ev => {
		if (ev.key === "ArrowUp" && historyIndex > 0) {
			if (historyIndex === history.length) draft = inputEl.value;
			historyIndex--;
			inputEl.value = history[historyIndex];
			ev.preventDefault();
		} else if (ev.key === "ArrowDown" && historyIndex < history.length) {
			historyIndex++;
			inputEl.value = historyIndex === history.length ? draft : history[historyIndex];
			ev.preventDefault();
		} else if (ev.key === "c" && ev.ctrlKey && !inputEl.value) {
			send({ type: "bash:kill" });
			renderOut("meta", "^C");
			ev.preventDefault();
		} else if (ev.key === "Tab" && !inputEl.value) {
			setMode(mode === "js" ? "bash" : "js");
			ev.preventDefault();
		}
	});

	// #endregion

	// #region config editor

	const typeOf = v => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

	/** Scalars are edited bare in an input, objects/arrays as JSON in a textarea. */
	const valueEditor = (value, onChange) => {
		const kind = typeOf(value);
		let field;
		if (kind === "object" || kind === "array") {
			field = el("textarea", "input");
			field.value = JSON.stringify(value, null, 2);
			field.rows = Math.min(20, field.value.split("\n").length);
		} else {
			field = el("input", "input");
			field.type = "text";
			field.value = kind === "string" ? value : JSON.stringify(value);
		}
		field.dataset.kind = kind;
		field.addEventListener("input", () => {
			const parsed = parseField(field);
			field.classList.toggle("invalid", parsed.error);
			onChange();
		});
		return field;
	};

	const parseField = field => {
		const raw = field.value;
		const kind = field.dataset.kind;
		if (kind === "string") return { value: raw };
		try {
			return { value: JSON.parse(raw) };
		} catch {
			if (kind === "object" || kind === "array") return { error: true };
			// non-JSON text in a number/bool field becomes a string
			return { value: raw };
		}
	};

	const renderConfig = ({ name, content, error }, open) => {
		const details = el("details");
		if (open) details.open = true;
		const summary = el("summary");
		summary.appendChild(el("span", "", name));
		const dirty = el("span", "dirty", "");
		summary.appendChild(dirty);
		if (error) summary.appendChild(el("span", "err", error));
		details.appendChild(summary);
		const body = el("div", "body");
		details.appendChild(body);

		const fields = new Map();
		const markDirty = () => (dirty.textContent = "modified");

		const addRow = (key, value) => {
			const row = el("div", "row");
			const keyEl = el("span", "key", key);
			keyEl.appendChild(el("span", "type", typeOf(value)));
			row.appendChild(keyEl);
			const field = valueEditor(value, markDirty);
			fields.set(key, field);
			row.appendChild(field);
			const del = el("button", "btn small", "×");
			del.type = "button";
			del.title = "Remove key";
			del.addEventListener("click", () => {
				fields.delete(key);
				row.remove();
				markDirty();
			});
			row.appendChild(del);
			body.insertBefore(row, addRowEl);
		};

		const addRowEl = el("div", "row add");
		const newKey = el("input", "input");
		newKey.placeholder = "new key";
		const newVal = el("input", "input");
		newVal.placeholder = "value (JSON, or plain text for a string)";
		const addBtn = el("button", "btn small", "Add");
		addBtn.type = "button";
		addBtn.addEventListener("click", () => {
			const key = newKey.value.trim();
			if (!key || fields.has(key)) return;
			let value;
			try {
				value = JSON.parse(newVal.value);
			} catch {
				value = newVal.value;
			}
			addRow(key, value);
			newKey.value = "";
			newVal.value = "";
			markDirty();
		});
		addRowEl.append(newKey, newVal, addBtn);
		body.appendChild(addRowEl);

		for (const [key, value] of Object.entries(content || {})) addRow(key, value);

		const actions = el("div", "actions");
		const msg = el("span", "msg", "");
		const save = el("button", "btn small primary", "Save");
		save.addEventListener("click", async () => {
			const out = {};
			for (const [key, field] of fields) {
				const parsed = parseField(field);
				if (parsed.error) {
					msg.textContent = `invalid JSON in ${key}`;
					return;
				}
				out[key] = parsed.value;
			}
			save.disabled = true;
			msg.textContent = "saving…";
			try {
				const res = await fetch(`/dashboard/config/${encodeURIComponent(name)}`, {
					method: "PUT",
					credentials: "same-origin",
					headers: { "Content-Type": "application/json", Accept: "application/json" },
					body: JSON.stringify({ content: out }),
				});
				const data = await res.json().catch(() => ({}));
				if (!res.ok) throw new Error(data.error || res.statusText);
				msg.textContent = "saved, restart to apply";
				dirty.textContent = "";
			} catch (err) {
				msg.textContent = "save failed: " + err.message;
			} finally {
				save.disabled = false;
			}
		});
		actions.append(msg, save);
		body.appendChild(actions);
		return details;
	};

	const loadConfigs = async () => {
		configsEl.textContent = "loading…";
		const res = await fetch("/dashboard/config", {
			credentials: "same-origin",
			headers: { Accept: "application/json" },
		});
		if (!res.ok) {
			configsEl.textContent = "failed to load configs: " + res.status;
			return;
		}
		const openNames = new Set(
			[...configsEl.querySelectorAll("details[open] summary > span:first-child")].map(
				s => s.textContent
			)
		);
		configsEl.textContent = "";
		for (const cfg of await res.json()) {
			configsEl.appendChild(renderConfig(cfg, openNames.has(cfg.name)));
		}
	};

	// #endregion

	// #region header

	$("#logout").addEventListener("click", async () => {
		await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
		location.href = "/";
	});

	$("#restart").addEventListener("click", async () => {
		if (!confirm("Exit the process? It only comes back if the container restarts it.")) return;
		await fetch("/dashboard/restart", {
			method: "POST",
			credentials: "same-origin",
			headers: { Accept: "application/json" },
		});
		renderOut("meta", "restart requested");
	});

	// #endregion

	connect();
	loadConfigs();
})();
