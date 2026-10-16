/* 星语人格 · 立项汇报稿 — 图表与流程图初始化
   颜色一律从 CSS 变量派生，避免与主题脱钩 */
(function () {
  var style = getComputedStyle(document.documentElement);
  function v(name) { return style.getPropertyValue(name).trim(); }

  var bg = v('--bg');
  var bg2 = v('--bg2');
  var ink = v('--ink');
  var muted = v('--muted');
  var rule = v('--rule');
  var accent = v('--accent');
  var accent2 = v('--accent2');
  var font = v('--font');

  /* ---------- 图 1：主流程（Mermaid） ---------- */
  if (window.mermaid) {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      securityLevel: 'loose',
      fontFamily: font,
      themeVariables: {
        background: bg2,
        primaryColor: bg2,
        primaryTextColor: ink,
        primaryBorderColor: accent,
        secondaryColor: bg,
        secondaryTextColor: ink,
        secondaryBorderColor: accent2,
        tertiaryColor: bg,
        tertiaryTextColor: ink,
        lineColor: accent,
        textColor: ink,
        nodeTextColor: ink,
        edgeLabelBackground: bg2,
        fontSize: '14px'
      },
      flowchart: {
        curve: 'basis', htmlLabels: true, padding: 10,
        nodeSpacing: 30, rankSpacing: 36, useMaxWidth: false
      }
    });
    mermaid.run({ querySelector: 'pre.mermaid' });
  }

  /* ---------- 图 2：题库维度分布 ---------- */
  var dimEl = document.getElementById('chart-dim');
  if (dimEl && window.echarts) {
    var cDim = echarts.init(dimEl, null, { renderer: 'svg' });
    cDim.setOption({
      animation: false,
      backgroundColor: 'transparent',
      grid: { left: 10, right: 56, top: 24, bottom: 4, containLabel: true },
      tooltip: {
        trigger: 'axis',
        appendToBody: true,
        axisPointer: { type: 'shadow' },
        backgroundColor: bg2,
        borderColor: rule,
        textStyle: { color: ink, fontSize: 12 },
        formatter: function (p) {
          return p[0].name + '：' + p[0].value + ' 题';
        }
      },
      xAxis: {
        type: 'value',
        min: 0,
        max: 4,
        minInterval: 1,
        axisLabel: { color: muted, formatter: '{value} 题' },
        axisLine: { lineStyle: { color: rule } },
        splitLine: { lineStyle: { color: rule } }
      },
      yAxis: {
        type: 'category',
        inverse: true,
        data: ['D1 表达取向', 'D2 能量取向', 'D3 决策取向', 'D4 关系取向'],
        axisLabel: { color: ink, fontSize: 12 },
        axisLine: { lineStyle: { color: rule } },
        axisTick: { show: false }
      },
      series: [{
        type: 'bar',
        barWidth: 16,
        data: [3, 3, 2, 2],
        itemStyle: {
          borderRadius: [0, 6, 6, 0],
          /* D1 / D2 为奇数题量、D3 / D4 为偶数题量：同分仅可能出现在后两者 */
          color: function (p) { return p.value >= 3 ? accent : accent2; }
        },
        label: {
          show: true,
          position: 'right',
          color: ink,
          fontSize: 12,
          formatter: '{c} 题'
        }
      }]
    });
    window.addEventListener('resize', function () { cDim.resize(); });
  }

  /* ---------- 图 3：同频度档位与展示值 ---------- */
  var bandEl = document.getElementById('chart-band');
  if (bandEl && window.echarts) {
    var cBand = echarts.init(bandEl, null, { renderer: 'svg' });
    var bandLabels = ['极致互补型', '差异互补型', '均衡互补型', '高默契型', '同频共振型'];
    var bandC = [0, 1, 2, 3, 4];
    var bandVals = [66.7, 75, 83.3, 91.7, 100];
    var bandData = bandC.map(function (c, i) {
      return { value: bandVals[i], name: bandLabels[i] + '（C=' + c + '）' };
    });

    cBand.setOption({
      animation: false,
      backgroundColor: 'transparent',
      grid: { left: 10, right: 62, top: 24, bottom: 4, containLabel: true },
      tooltip: {
        trigger: 'axis',
        appendToBody: true,
        axisPointer: { type: 'shadow' },
        backgroundColor: bg2,
        borderColor: rule,
        textStyle: { color: ink, fontSize: 12 },
        formatter: function (p) {
          return p[0].name + '<br/>展示值：' + p[0].value + '%';
        }
      },
      xAxis: {
        type: 'value',
        min: 0,
        max: 100,
        axisLabel: { color: muted, formatter: '{value}%' },
        axisLine: { lineStyle: { color: rule } },
        splitLine: { lineStyle: { color: rule } }
      },
      yAxis: {
        type: 'category',
        inverse: true,
        data: bandData.map(function (d) { return d.name; }),
        axisLabel: { color: ink, fontSize: 12 },
        axisLine: { lineStyle: { color: rule } },
        axisTick: { show: false }
      },
      series: [{
        type: 'bar',
        barWidth: 16,
        data: bandData,
        /* 全档同一配色：档位之间不做优劣区分 */
        itemStyle: { color: accent, borderRadius: [0, 6, 6, 0] },
        label: {
          show: true,
          position: 'right',
          color: ink,
          fontSize: 12,
          formatter: '{c}%'
        }
      }]
    });
    window.addEventListener('resize', function () { cBand.resize(); });
  }
})();
