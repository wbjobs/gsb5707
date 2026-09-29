/* 主逻辑：UI 绑定、全局控制、历史记录 */
(() => {
  const STATUS_TEXT = {
    idle: '未启动',
    requesting: '申请权限中…',
    active: '采集中',
    paused: '已暂停',
    denied: '权限被拒',
    unsupported: '不支持',
    insecure: '非安全上下文',
    error: '错误',
    simulated: '模拟数据',
    manual: '手动输入',
  };

  const FMT = {
    illuminance: (v) => v.toFixed(1),
    alpha: (v) => v.toFixed(1),
    beta: (v) => v.toFixed(1),
    gamma: (v) => v.toFixed(1),
    lat: (v) => v.toFixed(5),
    lng: (v) => v.toFixed(5),
    acc: (v) => v.toFixed(0),
  };

  // 非安全上下文提示
  if (!window.isSecureContext) {
    document.getElementById('secure-banner').classList.remove('hidden');
  }

  const sessionBuffer = []; // 当前会话待保存的读数
  const channels = {};
  const charts = {};
  const valueEls = {};
  const cards = document.querySelectorAll('.card');

  function makeChannel(Card, Class, keys, seriesColors) {
    const card = document.querySelector(`.card[data-sensor="${Card}"]`);
    const statusEl = card.querySelector('[data-role="status"]');
    const hintEl = card.querySelector('[data-role="hint"]');
    valueEls[Card] = {};
    keys.forEach((k) => {
      valueEls[Card][k] = card.querySelector(`[data-role="${k}"]`);
    });

    charts[Card] = new LineChart(
      card.querySelector('.chart'),
      keys.map((k, i) => ({ key: k, color: seriesColors[i], label: k }))
    );

    const channel = new Class({
      onReading: (values, ts) => {
        keys.forEach((k) => {
          if (values[k] != null) valueEls[Card][k].textContent = FMT[k](values[k]);
        });
        charts[Card].push(values, ts);
        sessionBuffer.push({ sensor: Card, mode: channel.mode, ts, values });
        updateRunState();
      },
      onStatus: (state, detail) => {
        statusEl.textContent = STATUS_TEXT[state] || state;
        statusEl.className = 'badge st-' + state;
        hintEl.textContent = detail || '';
        hintEl.classList.toggle('err', ['denied', 'error', 'insecure'].includes(state));
        updateRunState();
      },
    });
    channels[Card] = channel;

    // 每卡片按钮
    card.querySelector('[data-role="request"]').addEventListener('click', () => channel.startReal());
    card.querySelector('[data-role="simulate"]').addEventListener('click', () => channel.startSimulated());
    const manualPanel = card.querySelector('[data-role="manual-panel"]');
    card.querySelector('[data-role="manual-toggle"]').addEventListener('click', () => {
      manualPanel.classList.toggle('hidden');
      if (!manualPanel.classList.contains('hidden') && channel.mode !== 'manual') {
        channel.startManual();
        pushManual(Card, card, keys);
      }
    });
    // 手动滑块
    keys.forEach((k) => {
      const slider = card.querySelector(`[data-role="manual-${k}"]`);
      if (!slider) return;
      slider.addEventListener('input', () => {
        card.querySelector(`[data-role="manual-${k}-val"]`).textContent = slider.value;
        pushManual(Card, card, keys);
      });
    });
  }

  function pushManual(name, card, keys) {
    const values = {};
    keys.forEach((k) => {
      const slider = card.querySelector(`[data-role="manual-${k}"]`);
      values[k] = slider ? parseFloat(slider.value) : null;
    });
    channels[name].manualUpdate(values);
  }

  makeChannel('light', LightChannel, ['illuminance'], ['#f2c94c']);
  makeChannel('orientation', OrientationChannel, ['alpha', 'beta', 'gamma'], ['#4f8cff', '#2fbf71', '#e05252']);
  makeChannel('geolocation', GeoChannel, ['lat', 'lng', 'acc'], ['#9b51e0', '#2fbf71', '#e0a63c']);

  // ---------- 全局控制 ----------
  const btnStart = document.getElementById('btn-start');
  const btnPause = document.getElementById('btn-pause');
  const btnStop = document.getElementById('btn-stop');
  let paused = false;

  btnStart.addEventListener('click', () => {
    // 用户点击即用户手势，权限申请安全
    Object.values(channels).forEach((ch) => {
      if (ch.state === 'idle' || ch.state === 'denied' || ch.state === 'error') ch.startReal();
    });
    btnPause.disabled = false;
    btnStop.disabled = false;
  });

  btnPause.addEventListener('click', () => {
    paused = !paused;
    Object.values(channels).forEach((ch) => (paused ? ch.pause() : ch.resume()));
    btnPause.textContent = paused ? '继续' : '暂停';
  });

  btnStop.addEventListener('click', () => {
    paused = false;
    btnPause.textContent = '暂停';
    btnPause.disabled = true;
    btnStop.disabled = true;
    Object.values(channels).forEach((ch) => ch.stop());
    updateRunState();
  });

  document.getElementById('btn-clear').addEventListener('click', () => {
    Object.values(charts).forEach((c) => c.clear());
    sessionBuffer.length = 0;
    Object.values(valueEls).forEach((els) =>
      Object.values(els).forEach((el) => { el.textContent = '--'; })
    );
    updateRunState();
  });

  // ---------- 历史记录 ----------
  const historyList = document.getElementById('history-list');
  const historyCount = document.getElementById('history-count');

  function fmtValues(sensor, values) {
    return Object.entries(values)
      .filter(([, v]) => v != null)
      .map(([k, v]) => `${k}=${FMT[k] ? FMT[k](v) : v}`)
      .join('  ');
  }

  async function refreshHistory() {
    try {
      const rows = await SensorDB.getAll(100);
      historyCount.textContent = `（最近 ${rows.length} 条）`;
      if (!rows.length) {
        historyList.innerHTML = '<p class="hint">暂无历史数据。</p>';
        return;
      }
      historyList.innerHTML = rows.map((r) => {
        const time = new Date(r.ts).toLocaleString();
        const src = r.mode === 'real' ? '传感器' : r.mode === 'simulated' ? '模拟' : '手动';
        return `<div class="history-item">
          <span>${time} · ${r.sensor} · ${fmtValues(r.sensor, r.values)}</span>
          <span class="src">${src}</span>
        </div>`;
      }).join('');
    } catch (e) {
      historyList.innerHTML = `<p class="hint err">读取历史失败：${e.message}</p>`;
    }
  }

  document.getElementById('btn-save').addEventListener('click', async () => {
    if (!sessionBuffer.length) { updateRunState('没有可保存的数据'); return; }
    try {
      const n = await SensorDB.addBatch(sessionBuffer.splice(0));
      updateRunState(`已保存 ${n} 条记录`);
      refreshHistory();
    } catch (e) {
      updateRunState('保存失败：' + e.message);
    }
  });

  document.getElementById('btn-export').addEventListener('click', async () => {
    const rows = await SensorDB.getAll(100000);
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sensor-history-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  document.getElementById('btn-clear-history').addEventListener('click', async () => {
    await SensorDB.clear();
    refreshHistory();
    updateRunState('历史已清空');
  });

  function updateRunState(msg) {
    const el = document.getElementById('run-state');
    if (msg) { el.textContent = '状态：' + msg; return; }
    const active = Object.values(channels).filter((c) =>
      ['active', 'simulated', 'manual'].includes(c.state)).length;
    el.textContent = `状态：${active ? `采集中（${active}/3）` : '空闲'} · 待保存 ${sessionBuffer.length} 条`;
  }

  refreshHistory();
  updateRunState();
})();
