(function () {
  'use strict';

  var ROUND_TIME = 90;
  var PAIR_POINTS = 100;
  var BONUS_PER_SEC = 10;
  var MISMATCH_DELAY = 1000;

  var ARTIFACTS = [
    { id: 'amphora', emoji: '🏺', name: 'Амфора' },
    { id: 'coin',    emoji: '🪙', name: 'Монета' },
    { id: 'mask',    emoji: '🎭', name: 'Маска' },
    { id: 'urn',     emoji: '⚱️', name: 'Урна' },
    { id: 'scroll',  emoji: '📜', name: 'Свиток' },
    { id: 'idol',    emoji: '🗿', name: 'Идол' },
    { id: 'dagger',  emoji: '🗡️', name: 'Кинжал' },
    { id: 'ring',    emoji: '💍', name: 'Перстень' }
  ];

  var boardEl = document.getElementById('board');
  var timerEl = document.getElementById('timer');
  var pairsEl = document.getElementById('pairs');
  var scoreEl = document.getElementById('score');
  var overlayEl = document.getElementById('overlay');
  var dialogEl = overlayEl.querySelector('.dialog');
  var titleEl = document.getElementById('result-title');
  var textEl = document.getElementById('result-text');
  var againBtn = document.getElementById('again');

  var cards = [];        // { artifact, el, open, found }
  var layout = '';       // сигнатура расклада для проверки отличия
  var first = null;
  var locked = false;
  var playing = false;
  var found = 0;
  var score = 0;
  var timeLeft = ROUND_TIME;
  var tickId = null;
  var flipBackId = null;


  // ---------- Звук (Web Audio, без внешних файлов) ----------
  var audioCtx = null;
  var noiseBuf = null;

  function getAudio() {
    if (!audioCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function getNoise(ctx) {
    if (!noiseBuf) {
      var len = Math.floor(ctx.sampleRate * 0.3);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }

  // Шелест бумаги 
  function playFlip() {
    var ctx = getAudio();
    if (!ctx) return;
    var t0 = ctx.currentTime;
    var dur = 0.3;

    var src = ctx.createBufferSource();
    src.buffer = getNoise(ctx);

    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.5;
    bp.frequency.setValueAtTime(1800, t0);
    bp.frequency.linearRampToValueAtTime(3200, t0 + dur);

    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4500;

    var g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.01, t0 + 0.06);   // плавное нарастание
    g.gain.linearRampToValueAtTime(0.05, t0 + 0.11);   // шуршание
    g.gain.linearRampToValueAtTime(0.000001, t0 + 0.16);
    g.gain.linearRampToValueAtTime(0.04, t0 + 0.22);
    g.gain.linearRampToValueAtTime(0.5, t0 + dur);       // плавное затухание

    src.connect(bp); bp.connect(lp); lp.connect(g); g.connect(ctx.destination);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // Совпадение: короткий восходящий звон (до-ми-соль)
  function playMatch() {
    var ctx = getAudio();
    if (!ctx) return;
    var t0 = ctx.currentTime;
    [523.25, 659.25, 783.99].forEach(function (f, i) {
      var t = t0 + i * 0.09;
      var osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.5);
    });
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function makeDeck() {
    var base = ARTIFACTS.concat(ARTIFACTS);
    var deck, sig;
    do {
      deck = shuffle(base);
      sig = deck.map(function (a) { return a.id; }).join(',');
    } while (sig === layout);
    layout = sig;
    return deck;
  }

  function render(deck) {
    boardEl.innerHTML = '';
    cards = deck.map(function (artifact, i) {
      var el = document.createElement('button');
      el.type = 'button';
      el.className = 'card';
      el.setAttribute('aria-label', 'Участок раскопа ' + (i + 1));
      el.innerHTML =
        '<div class="inner">' +
          '<div class="face front"></div>' +
          '<div class="face back"><span class="emoji" aria-hidden="true">' + artifact.emoji +
          '</span><span class="name">' + artifact.name + '</span></div>' +
        '</div>';
      var card = { artifact: artifact, el: el, open: false, found: false };
      el.addEventListener('click', function () { onCard(card); });
      boardEl.appendChild(el);
      return card;
    });
  }

  function updateHud() {
    timerEl.textContent = timeLeft;
    timerEl.classList.toggle('low', timeLeft <= 10);
    pairsEl.textContent = found + ' / ' + ARTIFACTS.length;
    scoreEl.textContent = score;
  }

  function setOpen(card, value) {
    card.open = value;
    card.el.classList.toggle('open', value);
  }

  function onCard(card) {
    if (!playing || locked || card.open || card.found) return;
    setOpen(card, true);
    playFlip();

    if (!first) { first = card; return; }

    var second = card;
    if (first.artifact.id === second.artifact.id) {
      [first, second].forEach(function (c) {
        c.found = true;
        c.el.classList.add('found', 'pulse');
        c.el.setAttribute('aria-label', 'Найдено: ' + c.artifact.name);
      });
      first = null;
      found++;
      setTimeout(playMatch, 200);
      score += PAIR_POINTS;
      updateHud();
      if (found === ARTIFACTS.length) endRound(true);
    } else {
      locked = true;
      var a = first;
      first = null;
      flipBackId = setTimeout(function () {
        flipBackId = null;
        setOpen(a, false);
        setOpen(second, false);
        locked = false;
      }, MISMATCH_DELAY);
    }
  }

  function tick() {
    timeLeft--;
    updateHud();
    if (timeLeft <= 0) endRound(false);
  }

  function endRound(won) {
    playing = false;
    clearInterval(tickId);
    clearTimeout(flipBackId);
    flipBackId = null;

    if (won) {
      var bonus = timeLeft * BONUS_PER_SEC;
      score += bonus;
      updateHud();
      dialogEl.className = 'dialog win';
      titleEl.textContent = 'Экспедиция удалась!';
      textEl.textContent = 'Итоговый счёт: ' + score;
    } else {
      dialogEl.className = 'dialog lose';
      titleEl.textContent = 'Грант закончился';
      textEl.textContent = 'Найдено пар: ' + found + ' из ' + ARTIFACTS.length + '. Счёт: ' + score + '.';
    }
    overlayEl.hidden = false;
    againBtn.focus();
  }

  function startRound() {
    clearInterval(tickId);
    clearTimeout(flipBackId);
    overlayEl.hidden = true;
    first = null;
    locked = false;
    found = 0;
    score = 0;
    timeLeft = ROUND_TIME;
    render(makeDeck());
    updateHud();
    playing = true;
    tickId = setInterval(tick, 1000);
  }

  againBtn.addEventListener('click', startRound);
  startRound();
})();
