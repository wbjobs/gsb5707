(() => {
  const TICK_MS = 500;
  const HISTORY_SHOW = 20;

  const STATE_TEXT = {
    unknown: ['未知', ''],
    unsupported: ['不支持', 'err'],
    insecure: ['非安全上下文', 'err'],
    prompt: ['待授权', 'warn'],
    granted: ['已授权', 'ok'],
    denied: ['已拒绝', 'err'],
    revoked: ['已撤销', 'err']
  };

  const STATE_HINT = {
    unsupported: '浏览器不支持该传感器，已降级为模拟数据，也可改用手动输入。',
    insecure: '非安全上下文（需 HTTPS 或 localhost），已降级为模拟数据。',
    prompt: '等待授权：权限申请需由点击「开始」触发，浏览器不会自动弹窗。',
    granted: '',
    denied: '权限被拒绝，已降级为模拟数据，也可改用手动输入。可在浏览器设置中重新允许。',
    revoked: '权限已被撤销，已自动切换为模拟数据。',
    unknown: ''
  };

  const MODE_TEXT = {
    real: ['来源：传感器', 'ok'],
    simulated: ['来源：模拟数据', 'warn'],
    manual: ['来源：手动输入', 'warn']
  };

  const cards = {
    light: document.getElementById('card-light'),
    orientation: document.getElementById('card-orientation'),
    geo: document.getElementById('card-geo')
  };

  const ui = {};
  for (const [key, card] of Object.entries(cards)) {
    ui[key] = {
      perm: card.querySelector('[data-role="perm"]'),
      source: card.querySelector('[data-role="source"]'),
      hint: card.querySelector('[data-role="hint"]'),
      manualRow: card.querySelector('[data-role="manual"]'),
      chart: new TimeChart(
        card.querySelector('[data-role="chart"]'),
        key === 'light' ? ['lux'] : key === 'orientation' ? ['α', 'β', 'γ'] : ['Δ北 (m)', 'Δ东 (m)']
      )
    };
  }
  ui.light.value = cards.light.querySelector('[data-role="value"]');
  ui.light.manualInput = cards.light.querySelector('[data-role="manual-input"]');
  ui.orientation.values = {
    alpha: cards.orientation.querySelector('[data-role="value-alpha"]'),
    beta: cards.orientation.querySelector('[data-role="value-beta"]'),
    gamma: cards.orientation.querySelector('[data-role="value-gamma"]')
  };
  ui.orientation.manual = {
    alpha: cards.orientation.querySelector('[data-role="manual-alpha"]'),
    beta: cards.orientation.querySelector('[data-role="manual-beta"]'),
    gamma: cards.orientation.querySelector('[data-role="manual-gamma"]')
  };
  ui.geo.values = {
    lat: cards.geo.querySelector('[data-role="value-lat"]'),
    lng: cards.geo.querySelector('[data-role="value-lng"]'),
    acc: cards.geo.querySelector('[data-role="value-acc"]')
  };
  ui.geo.manual = {
    lat: cards.geo.querySelector('[data-role="manual-lat"]'),
    lng: cards.geo.querySelector('[data-role="manual-lng"]')
  };

  const btnStart = document.getElementById('btn-start');
  const btnPause = document.getElementById('btn-pause');
  const btnStop = document.getElementById('btn-stop');
  const btnClear = document.getElementById('btn-clear');
  const runState = document.getElementById('run-state');
  const historyCount = document.getElementById('history-count');
  const historyList = document.getElementById('history-list');

  const channels = {
    light: new LightChannel(),
    orientation: new OrientationChannel(),
    geo: new GeoChannel()
  };

  const smooth = {
    lux: new Smoother(0.3, 80),
    alpha: new Smoother(0.3, 25),
    beta: new Smoother(0.3, 20),
    gamma: new Smoother(0.3, 20),
    lat: new Smoother(0.4, 0.002),
    lng: new Smoother(0.4, 0.002)
  };
  const alphaUnwrap = new AngleUnwrapper();

  const latest = {
    lux: null, alpha: null, beta: null, gamma: null,
    lat: null, lng: null, acc: null
  };
  let geoOrigin = null;

  let runStatus = 'idle';
  let tickTimer = null;

  function updateBadge(key, state, mode) {
    const [permText, permCls] = STATE_TEXT[state] || STATE_TEXT.unknown;
    const permEl = ui[key].perm;
    permEl.textContent = `权限：${permText}`;
    permEl.className = 'badge' + (permCls ? ' ' + permCls : '');

    const srcEl = ui[key].source;
    if (mode && MODE_TEXT[mode]) {
      const [srcText, srcCls] = MODE_TEXT[mode];
      srcEl.textContent = srcText;
      srcEl.className = 'badge badge-src ' + srcCls;
    } else {
      srcEl.textContent = '来源：—';
      srcEl.className = 'badge badge-src';
    }

    ui[key].hint.textContent = STATE_HINT[state] || '';
    const fallbackActive = mode === 'simulated' || mode === 'manual';
    ui[key].manualRow.classList.toggle('hidden', !fallbackActive);
  }

  for (const [key, ch] of Object.entries(channels)) {
    ch.onStateChange = (state, mode) => updateBadge(key, state, mode);
  }

  channels.light.onData = d => {
    latest.lux = smooth.lux.update(d.illuminance);
  };
  channels.orientation.onData = d => {
    const unwrapped = alphaUnwrap.update(d.alpha);
    latest.alpha = smooth.alpha.update(unwrapped);
    latest.beta = smooth.beta.update(d.beta);
    latest.gamma = smooth.gamma.update(d.gamma);
  };
  channels.geo.onData = d => {
    latest.lat = smooth.lat.update(d.lat);
    latest.lng = smooth.lng.update(d.lng);
    latest.acc = d.accuracy;
  };

  function applyManual(key) {
    const ch = channels[key];
    ch.stopAll();
    ch.setMode('manual');
    updateBadge(key, ch.state, 'manual');
  }

  cards.light.querySelector('[data-role="manual-apply"]').addEventListener('click', () => applyManual('light'));
  cards.orientation.querySelector('[data-role="manual-apply"]').addEventListener('click', () => applyManual('orientation'));
  cards.geo.querySelector('[data-role="manual-apply"]').addEventListener('click', () => applyManual('geo'));

  function feedManual() {
    if (channels.light.mode === 'manual') {
      const v = parseFloat(ui.light.manualInput.value);
      if (!Number.isNaN(v)) latest.lux = smooth.lux.update(v);
    }
    if (channels.orientation.mode === 'manual') {
      const a = parseFloat(ui.orientation.manual.alpha.value);
      const b = parseFloat(ui.orientation.manual.beta.value);
      const g = parseFloat(ui.orientation.manual.gamma.value);
      if (!Number.isNaN(a)) latest.alpha = smooth.alpha.update(alphaUnwrap.update(a));
      if (!Number.isNaN(b)) latest.beta = smooth.beta.update(b);
      if (!Number.isNaN(g)) latest.gamma = smooth.gamma.update(g);
    }
    if (channels.geo.mode === 'manual') {
      const la = parseFloat(ui.geo.manual.lat.value);
      const ln = parseFloat(ui.geo.manual.lng.value);
      if (!Number.isNaN(la)) latest.lat = smooth.lat.update(la);
      if (!Number.isNaN(ln)) latest.lng = smooth.lng.update(ln);
      latest.acc = null;
    }
  }

  function render() {
    if (latest.lux !== null) ui.light.value.textContent = latest.lux.toFixed(0);
    if (latest.alpha !== null) {
      const a = ((latest.alpha % 360) + 360) % 360;
      ui.orientation.values.alpha.textContent = a.toFixed(1);
    }
    if (latest.beta !== null) ui.orientation.values.beta.textContent = latest.beta.toFixed(1);
    if (latest.gamma !== null) ui.orientation.values.gamma.textContent = latest.gamma.toFixed(1);
    if (latest.lat !== null) ui.geo.values.lat.textContent = latest.lat.toFixed(5);
    if (latest.lng !== null) ui.geo.values.lng.textContent = latest.lng.toFixed(5);
    ui.geo.values.acc.textContent = latest.acc !== null ? latest.acc.toFixed(0) : '--';
  }

  function pushCharts(ts) {
    if (latest.lux !== null) ui.light.chart.push(ts, [latest.lux]);
    if (latest.alpha !== null || latest.beta !== null || latest.gamma !== null) {
      ui.orientation.chart.push(ts, [latest.alpha, latest.beta, latest.gamma]);
    }
    if (latest.lat !== null && latest.lng !== null) {
      if (!geoOrigin) geoOrigin = { lat: latest.lat, lng: latest.lng };
      const metersPerLat = 111320;
      const metersPerLng = 111320 * Math.cos((geoOrigin.lat * Math.PI) / 180);
      ui.geo.chart.push(ts, [
        (latest.lat - geoOrigin.lat) * metersPerLat,
        (latest.lng - geoOrigin.lng) * metersPerLng
      ]);
    }
  }

  function sourceOf(key) {
    const m = channels[key].mode;
    return m === 'real' ? '传感器' : m === 'manual' ? '手动' : '模拟';
  }

  function saveSample(ts) {
    const sample = {
      ts,
      lux: latest.lux, alpha: latest.alpha, beta: latest.beta, gamma: latest.gamma,
      lat: latest.lat, lng: latest.lng,
      sources: [sourceOf('light'), sourceOf('orientation'), sourceOf('geo')].join('/')
    };
    SensorDB.add(sample).then(refreshHistory).catch(() => {});
  }

  function tick() {
    if (runStatus !== 'running') return;
    const ts = Date.now();
    feedManual();
    render();
    pushCharts(ts);
    saveSample(ts);
  }

  function fmtSample(s) {
    const time = new Date(s.ts).toLocaleTimeString('zh-CN', { hour12: false });
    const parts = [];
    if (s.lux !== null && s.lux !== undefined) parts.push(`光照 ${s.lux.toFixed(0)} lux`);
    if (s.alpha !== null && s.alpha !== undefined) {
      parts.push(`方向 α${(((s.alpha % 360) + 360) % 360).toFixed(0)}° β${s.beta.toFixed(0)}° γ${s.gamma.toFixed(0)}°`);
    }
    if (s.lat !== null && s.lat !== undefined) parts.push(`位置 ${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}`);
    return { time, text: parts.join(' · '), sources: s.sources || '' };
  }

  async function refreshHistory() {
    try {
      const [items, total] = await Promise.all([SensorDB.getRecent(HISTORY_SHOW), SensorDB.count()]);
      historyCount.textContent = `${total} 条`;
      historyList.innerHTML = '';
      for (const s of items) {
        const li = document.createElement('li');
        const f = fmtSample(s);
        const left = document.createElement('span');
        left.innerHTML = `<span class="hv">${f.time}</span> ${f.text}`;
        const right = document.createElement('span');
        right.textContent = f.sources;
        li.appendChild(left);
        li.appendChild(right);
        historyList.appendChild(li);
      }
    } catch (e) {}
  }

  function setRunStatus(status) {
    runStatus = status;
    const textMap = { idle: '未启动', running: '运行中', paused: '已暂停', stopped: '已停止' };
    runState.textContent = textMap[status];
    btnStart.disabled = status === 'running' || status === 'paused';
    btnPause.disabled = !(status === 'running' || status === 'paused');
    btnPause.textContent = status === 'paused' ? '继续' : '暂停';
    btnStop.disabled = !(status === 'running' || status === 'paused');
  }

  async function start() {
    document.getElementById('gesture-banner').classList.add('hidden');
    setRunStatus('running');
    const jobs = Object.values(channels).map(ch =>
      ch.startReal().catch(() => {
        ch.setState(SensorState.UNSUPPORTED);
        ch.startSimulated();
      })
    );
    await Promise.all(jobs);
    if (!tickTimer) tickTimer = setInterval(tick, TICK_MS);
  }

  function pause() {
    if (runStatus === 'running') {
      setRunStatus('paused');
    } else if (runStatus === 'paused') {
      setRunStatus('running');
    }
  }

  function stop() {
    for (const ch of Object.values(channels)) ch.stopAll();
    setRunStatus('stopped');
  }

  async function clearAll() {
    for (const key of Object.keys(ui)) {
      if (ui[key].chart) ui[key].chart.clear();
    }
    for (const s of Object.values(smooth)) s.reset();
    alphaUnwrap.reset();
    for (const k of Object.keys(latest)) latest[k] = null;
    geoOrigin = null;
    ui.light.value.textContent = '--';
    ui.orientation.values.alpha.textContent = '--';
    ui.orientation.values.beta.textContent = '--';
    ui.orientation.values.gamma.textContent = '--';
    ui.geo.values.lat.textContent = '--';
    ui.geo.values.lng.textContent = '--';
    ui.geo.values.acc.textContent = '--';
    try {
      await SensorDB.clear();
    } catch (e) {}
    refreshHistory();
  }

  btnStart.addEventListener('click', () => { start(); });
  btnPause.addEventListener('click', pause);
  btnStop.addEventListener('click', stop);
  btnClear.addEventListener('click', () => { clearAll(); });

  function init() {
    if (!window.isSecureContext) {
      document.getElementById('secure-banner').classList.remove('hidden');
    } else {
      document.getElementById('gesture-banner').classList.remove('hidden');
    }
    for (const [key, ch] of Object.entries(channels)) {
      const env = ch.checkEnv();
      if (env) {
        updateBadge(key, env, null);
      } else {
        ch.queryPermission().then(state => {
          if (state === 'granted') updateBadge(key, 'granted', null);
          else if (state === 'denied') updateBadge(key, 'denied', null);
          else updateBadge(key, 'prompt', null);
        });
      }
    }
    setRunStatus('idle');
    refreshHistory();
    window.addEventListener('resize', () => {
      for (const key of Object.keys(ui)) {
        if (ui[key].chart) ui[key].chart.draw();
      }
    });
  }

  init();
})();
