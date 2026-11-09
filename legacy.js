// Ported from the Claude-artifact dashboard by tools/port_legacy.py — UI code unchanged except where marked.

(function(){
  var STATE = window.__DASH__.initialState();

  function fmt(n){
    var neg = n < 0; n = Math.abs(Math.round(n));
    var s = n.toLocaleString('en-US');
    return (neg ? '-' : '') + s + ' ₪';
  }
  function fmtUsd(n){
    var neg = n < 0; n = Math.abs(Math.round(n));
    return (neg?'-':'') + '$' + n.toLocaleString('en-US');
  }
  // Four-channel model (13.10.2026): short / medium / long / real estate.
  // Totals are computed live from the components, so the daily and monthly
  // agents (which keep writing the same fields as before) flow straight in.
  function securitiesIls(f){
    var sm = f.shortMedium, ib = sm.ibkr || {};
    var cash = (ib.cashUsd||0) * (ib.fxUsdIls||0);
    return (sm.bank ? sm.bank.securities : 0) + (ib.totalIls||0) + cash;
  }
  // Since-purchase totals: cost is backed out of each holding's current value
  // and its gainPct (costBasis-based), so it stays right as daily prices move.
  function gainAgg(items, valKey){
    var val=0, cost=0, dw=0, dp=0;
    (items||[]).forEach(function(x){
      var v = x[valKey]||0; val += v;
      cost += (x.gainPct!=null) ? v/(1+x.gainPct/100) : v;
      if(x.changePct!=null){ dw += v; dp += v*x.changePct; }
    });
    return {value:val, cost:cost, gain:val-cost, gainPct: cost? (val/cost-1)*100 : null, dailyPct: dw? dp/dw : null};
  }
  function gainLineHTML(g){
    if(g.gainPct==null) return '';
    var up = g.gain>=0;
    return '<div class="fin-tile-nolive" style="margin-top:2px;">'+(up?'רווח':'הפסד')+' מאז קנייה: <b class="num" style="color:var(--'+(up?'ok':'critical')+');">'+(up?'+':'')+fmt(g.gain)+'</b> (עלות ~'+fmt(g.cost)+')</div>';
  }
  function shortTotal(f){ return (f.shortTerm && f.shortTerm.total) || 0; }
  function mediumTotal(f){ return securitiesIls(f) + (f.shortMedium.analystGemel ? f.shortMedium.analystGemel.value : 0); }
  function longTotal(f){
    var lt = f.longTerm, sm = f.shortMedium;
    return (lt.menorahGemel?lt.menorahGemel.value:0) + (lt.pension?lt.pension.value:0) + (sm.studyFund?sm.studyFund.value:0);
  }
  function investmentsTotal(f){
    return shortTotal(f) + mediumTotal(f) + longTotal(f);
  }
  function fmtPrice(h){
    if(h.price==null || h.changePct==null){ return 'אין מחיר זמין כרגע'; }
    var chgClass = h.changePct>=0?'up':'down';
    var chgSign = h.changePct>=0?'+':'';
    return 'מחיר: $'+h.price.toFixed(2)+' <span class="chg '+chgClass+'">('+chgSign+h.changePct.toFixed(2)+'%)</span>';
  }

  /* ---------- FINANCE TILES (Phase 2 redesign) ---------- */
  var FIN_TILE_COLORS = {
    menorahGemel: 'var(--cat-blue)',
    pension: 'var(--cat-teal)',
    bank: 'var(--cat-olive)',
    analystGemel: 'var(--cat-violet)',
    studyFund: 'var(--cat-orange)'
  };

  function changeArrowHTML(changePct){
    if(changePct==null) return '<span class="fin-tile-change flat">— אין נתון יומי</span>';
    var cls = changePct>=0 ? 'up' : 'down';
    var arrow = changePct>=0 ? '▲' : '▼';
    var sign = changePct>=0 ? '+' : '';
    return '<span class="fin-tile-change '+cls+'">'+arrow+' '+sign+changePct.toFixed(2)+'%</span>';
  }

  function finTileBadge(color, label){
    return '<span class="fin-tile-badge" style="border:1px solid '+color+';color:'+color+';"><span class="dot" style="background:'+color+';"></span>'+esc(label)+'</span>';
  }

  function ibkrWeightedChangePct(ibkr){
    var wsum = 0, psum = 0;
    ibkr.holdings.forEach(function(h){
      if(h.changePct != null){ wsum += h.pct; psum += h.pct * h.changePct; }
    });
    if(wsum === 0) return null;
    return psum / wsum;
  }

  function finSubRow(label, pct, value, color){
    return '<div class="fin-tile-sub-row"><div class="sr-top"><span>'+esc(label)+'</span><span class="v">'+pct+'% · '+fmt(value)+'</span></div>'
         + '<div class="bar-track"><div class="bar-fill" style="width:'+pct+'%;background:'+color+';"></div></div></div>';
  }

  function tileMenorahGemel(m){
    var color = FIN_TILE_COLORS.menorahGemel;
    var html = '<div class="fin-tile">';
    html += '<div class="fin-tile-top">'+finTileBadge(color,'טווח ארוך')+'<span class="fin-tile-nolive">אין מעקב מחיר יומי</span></div>';
    html += '<div><div class="fin-tile-title">קופת תגמולים — מנורה מבטחים</div><div class="fin-tile-value num">'+fmt(m.value)+'</div></div>';
    html += '<div class="fin-tile-sub">';
    m.tracks.forEach(function(t){ html += finSubRow(t.label, t.pct, t.value, color); });
    html += '</div>';
    html += '<div class="fin-tile-meta">'
          + '<div class="fin-tile-meta-row"><span>פוליסה</span><span class="v">'+esc(m.policy)+'</span></div>'
          + '<div class="fin-tile-meta-row"><span>נפתחה</span><span class="v">'+esc(m.opened)+'</span></div>'
          + '<div class="fin-tile-meta-row"><span>דמי ניהול</span><span class="v">'+esc(m.managementFee)+'</span></div>'
          + '</div>';
    html += '</div>';
    return html;
  }

  function tilePension(p){
    var color = FIN_TILE_COLORS.pension;
    var html = '<div class="fin-tile">';
    html += '<div class="fin-tile-top">'+finTileBadge(color,'טווח ארוך')+'<span class="fin-tile-nolive">אין מעקב מחיר יומי</span></div>';
    html += '<div><div class="fin-tile-title">'+esc(p.name)+'</div><div class="fin-tile-value num">'+fmt(p.value)+'</div></div>';
    html += '<div class="fin-tile-sub">'+finSubRow(p.track, 100, p.value, color)+'</div>';
    html += '<div class="fin-tile-meta">'
          + '<div class="fin-tile-meta-row"><span>פוליסה</span><span class="v">'+esc(p.policy)+'</span></div>'
          + '<div class="fin-tile-meta-row"><span>נפתחה</span><span class="v">'+esc(p.opened)+'</span></div>'
          + '<div class="fin-tile-meta-row"><span>דמי ניהול</span><span class="v">'+esc(p.managementFee)+'</span></div>'
          + '</div>';
    html += '</div>';
    return html;
  }

  function tileBank(b){
    var color = FIN_TILE_COLORS.bank;
    var html = '<div class="fin-tile">';
    html += '<div class="fin-tile-top">'+finTileBadge(color,'טווח בינוני')+'</div>';
    var bg = gainAgg(b.securitiesBreakdown, 'value');
    html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;"><div><div class="fin-tile-title">ניירות ערך בישראל — אוצר החייל</div><div class="fin-tile-value num">'+fmt(b.securities)+'</div>'+gainLineHTML(bg)+'</div>'+finReturnBlockHTML(bg.gainPct, bg.dailyPct)+'</div>';
    html += '<div class="fin-ibkr-holdings">';
    b.securitiesBreakdown.forEach(function(x){
      html += '<div class="fin-holding-row">';
      html += '<div class="fin-holding-top"><span class="nm">'+esc(x.label)+'</span>'+finReturnBlockHTML(x.gainPct, x.changePct)+'</div>';
      html += '<div class="bar-track"><div class="bar-fill" style="width:'+x.pct+'%;background:'+color+';"></div></div>';
      html += '<div class="fin-holding-vals"><span>'+x.pct.toFixed(2)+'% מהתיק · '+fmt(x.value)+'</span><span>'+(x.price!=null?('₪'+x.price.toFixed(2)):'אין מחיר זמין')+'</span></div>';
      if(x.units!=null){ html += '<div class="fin-holding-vals"><span>'+x.units.toFixed(2)+' יח׳</span><span></span></div>'; }
      html += '</div>';
    });
    html += '</div>';
    html += '<div class="fin-tile-meta">'
          + '<div class="fin-tile-meta-row"><span>מוחזק</span><span class="v">בחשבון ניירות הערך בבנק</span></div>'
          + (b.pricesAsOf?('<div class="fin-tile-meta-row"><span>מחירים (NAV) נכון ל</span><span class="v">'+esc(b.pricesAsOf)+'</span></div>'):'')
          + (b.unitsAsOf?('<div class="fin-tile-meta-row"><span>כמויות/תשואה סונכרנו ב</span><span class="v">'+esc(b.unitsAsOf)+'</span></div>'):'')
          + '</div>';
    html += '</div>';
    return html;
  }

  function tileAnalystGemel(a){
    var color = FIN_TILE_COLORS.analystGemel;
    var html = '<div class="fin-tile">';
    html += '<div class="fin-tile-top">'+finTileBadge(color,'טווח בינוני')+'<span class="fin-tile-nolive">אין מעקב מחיר יומי</span></div>';
    html += '<div><div class="fin-tile-title">קופת גמל להשקעה — אנליסט</div><div class="fin-tile-value num">'+fmt(a.value)+'</div></div>';
    html += '<div class="fin-tile-sub">';
    a.tracks.forEach(function(t){ html += finSubRow(t.label, t.pct, t.value, color); });
    html += '</div>';
    html += '<div class="fin-tile-meta">'
          + '<div class="fin-tile-meta-row"><span>פוליסה</span><span class="v">'+esc(a.policy)+'</span></div>'
          + '<div class="fin-tile-meta-row"><span>נפתחה</span><span class="v">'+esc(a.opened)+'</span></div>'
          + '<div class="fin-tile-meta-row"><span>דמי ניהול</span><span class="v">'+esc(a.managementFee)+'</span></div>'
          + '</div>';
    html += '</div>';
    return html;
  }

  function tileStudyFund(sf){
    var color = FIN_TILE_COLORS.studyFund;
    var html = '<div class="fin-tile">';
    html += '<div class="fin-tile-top">'+finTileBadge(color,'טווח ארוך')+'<span class="fin-tile-nolive">אין מעקב מחיר יומי</span></div>';
    html += '<div><div class="fin-tile-title">'+esc(sf.name)+'</div><div class="fin-tile-value num">'+fmt(sf.value)+'</div></div>';
    html += '<div class="fin-tile-sub">'+finSubRow(sf.track, 100, sf.value, color)+'</div>';
    html += '<div class="fin-tile-meta">'
          + '<div class="fin-tile-meta-row"><span>פוליסה</span><span class="v">'+esc(sf.policy)+'</span></div>'
          + '<div class="fin-tile-meta-row"><span>נפתחה</span><span class="v">'+esc(sf.opened)+'</span></div>'
          + '<div class="fin-tile-meta-row"><span>דמי ניהול</span><span class="v">'+esc(sf.managementFee)+'</span></div>'
          + '</div>';
    html += '</div>';
    return html;
  }

  function tileIbkr(ibkr){
    var color = 'var(--accent)';
    var ig = gainAgg(ibkr.holdings, 'valueIls');
    var html = '<div class="fin-tile">';
    html += '<div class="fin-tile-top">'+finTileBadge(color,'טווח בינוני')+'</div>';
    html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;"><div><div class="fin-tile-title">ניירות ערך בחו״ל — אוצר החייל</div><div class="fin-tile-value num">'+fmt(ibkr.totalIls)+' <span style="font-size:14px;color:var(--text-muted);">· '+fmtUsd(ibkr.totalUsd)+'</span></div>'+gainLineHTML(ig)+'</div>'+finReturnBlockHTML(ig.gainPct, ig.dailyPct)+'</div>';
    html += '<div class="fin-ibkr-holdings">';
    ibkr.holdings.forEach(function(h){
      html += '<div class="fin-holding-row">';
      html += '<div class="fin-holding-top"><span class="nm"><b style="color:var(--text);font-family:\'Roboto Mono\',monospace;">'+esc(h.ticker)+'</b> — '+esc(h.name)+'</span>'+finReturnBlockHTML(h.gainPct, h.changePct)+'</div>';
      html += '<div class="bar-track"><div class="bar-fill" style="width:'+h.pct+'%;background:'+color+';"></div></div>';
      html += '<div class="fin-holding-vals"><span>'+h.pct.toFixed(2)+'% מהתיק · '+fmt(h.valueIls)+'</span><span>'+(h.price!=null?('$'+h.price.toFixed(2)):'אין מחיר זמין')+'</span></div>';
      if(h.shares!=null){ html += '<div class="fin-holding-vals"><span>'+(Math.round(h.shares*100)/100)+' יח׳</span><span></span></div>'; }
      html += '</div>';
    });
    html += '</div>';
    html += '<div class="fin-tile-meta">'
          + '<div class="fin-tile-meta-row"><span>מוחזק</span><span class="v">בחשבון ניירות הערך בבנק (חו״ל)</span></div>'
          + '<div class="fin-tile-meta-row"><span>מחירים נכון ל</span><span class="v">'+esc(ibkr.pricesAsOf)+'</span></div>'
          + '<div class="fin-tile-meta-row"><span>שער דולר-שקל</span><span class="v">'+ibkr.fxUsdIls+' (מ-'+esc(ibkr.fxAsOf)+')</span></div>'
          + (ibkr.cashUsd?('<div class="fin-tile-meta-row"><span>'+esc(ibkr.cashNote||'מזומן')+'</span><span class="v">'+fmtUsd(ibkr.cashUsd)+'</span></div>'):'')
          + '</div>';
    html += '</div>';
    return html;
  }

  /* ---------- INSURANCE TILES ---------- */
  function insPremiumBadgeText(p){
    if(p.premiumAnnual != null){
      return fmt(p.premiumAnnual)+' לשנה (≈'+fmt(p.monthlyEquivalent)+' לחודש)';
    }
    return fmt(p.monthlyEquivalent)+' לחודש';
  }

  function tileInsurance(p){
    var html = '<div class="fin-tile">';
    html += '<div class="fin-tile-top">'+finTileBadge(p.domainColor, p.domain)+'<span class="fin-tile-nolive">'+esc(insPremiumBadgeText(p))+'</span></div>';
    html += '<div><div class="fin-tile-title">'+esc(p.company)+' — '+esc(p.title)+'</div>';
    if(p.coverage){
      html += '<div class="fin-tile-value num">'+fmt(p.coverage)+' <span style="font-size:12px;color:var(--text-muted);font-family:\'Assistant\',sans-serif;">סכום ביטוח</span></div>';
    }
    html += '</div>';
    if(p.coverages && p.coverages.length){
      html += '<div class="ins-cov-list">';
      p.coverages.forEach(function(c){
        html += '<div class="ins-cov-row"><span>'+esc(c.label)+'</span><span class="v">'+(c.premium?fmt(c.premium)+' לחודש':'ללא תוספת')+'</span></div>';
      });
      html += '</div>';
    }
    if(p.note){ html += '<div class="fin-tile-nolive">'+esc(p.note)+'</div>'; }
    html += '<div class="fin-tile-meta">'
          + '<div class="fin-tile-meta-row"><span>מספר פוליסה</span><span class="v">'+esc(p.policyNumber)+'</span></div>'
          + '<div class="fin-tile-meta-row"><span>תקופת ביטוח</span><span class="v">'+esc(p.period)+'</span></div>'
          + '</div>';
    html += '</div>';
    return html;
  }

  function insurancePanelHTML(ins){
    var html = '<div class="panel"><div class="panel-head"><h2>ביטוחים</h2><span class="badge">'+ins.policies.length+' פוליסות</span></div>';
    html += '<div class="fin-hero"><div class="n num">'+fmt(ins.totalMonthly)+' <span style="font-size:14px;color:var(--text-muted);font-family:\'Assistant\',sans-serif;">לחודש (משוער)</span></div>';
    html += '<div class="l">כ-'+fmt(ins.totalAnnual)+' בשנה, בכל הענפים (דירה, בריאות, חיים ואבדן כושר עבודה) · נכון ל-'+esc(ins.asOf)+' · '+esc(ins.source)+'</div></div>';
    html += '</div>';
    html += '<div class="fin-grid">';
    ins.policies.forEach(function(p){ html += tileInsurance(p); });
    html += '</div>';
    return html;
  }

  // Return display for each holding: "since purchase" (gainPct) shown large,
  // bold and colored with an arrow; "daily" (changePct) shown the same way
  // but smaller and less prominent, stacked beneath it.
  function finReturnBlockHTML(gainPct, changePct){
    var sinceHtml = gainPct != null
      ? '<div class="fin-return-row"><span class="rlabel">מאז קנייה</span><span class="fin-return-since '+(gainPct>=0?'up':'down')+'">'+(gainPct>=0?'▲':'▼')+' '+(gainPct>=0?'+':'')+gainPct.toFixed(2)+'%</span></div>'
      : '<div class="fin-return-row"><span class="fin-return-since flat">אין נתון תשואה</span></div>';
    var dailyHtml = changePct != null
      ? '<div class="fin-return-row"><span class="rlabel">יומי</span><span class="fin-return-daily '+(changePct>=0?'up':'down')+'">'+(changePct>=0?'▲':'▼')+' '+(changePct>=0?'+':'')+changePct.toFixed(2)+'%</span></div>'
      : '<div class="fin-return-row"><span class="fin-return-daily flat">אין נתון יומי</span></div>';
    return '<div class="fin-return-block">'+sinceHtml+dailyHtml+'</div>';
  }
  function esc(s){
    return String(s).replace(/[&<>"]/g, function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});
  }
  function parseHeDate(s){
    if(!s) return null;
    var parts = String(s).split('.');
    if(parts.length !== 3) return null;
    var d = parseInt(parts[0],10), m = parseInt(parts[1],10), y = parseInt(parts[2],10);
    if(!d || !m || !y) return null;
    return new Date(y, m-1, d);
  }
  function backLink(){
    return '<a class="back-link" href="#home">‹ דשבורד</a>';
  }
  // Months elapsed since a "MM/YYYY" purchase date, used to keep the real-estate
  // cumulative negative cash flow current on every page load without needing a
  // republish just for the passage of time.
  function reMonthsSincePurchase(dateStr){
    var parts = String(dateStr||'').split('/');
    if(parts.length!==2) return 0;
    var m = parseInt(parts[0],10), y = parseInt(parts[1],10);
    if(!m || !y) return 0;
    var now = new Date();
    var months = (now.getFullYear()-y)*12 + (now.getMonth()+1 - m);
    return months > 0 ? months : 0;
  }

  /* ---------- CALENDAR LINKING ---------- */
  // Note: "8. צוות מנת"ח" is deliberately excluded — classified calendar,
  // never queried or offered here.
  // Calendar list now lives in the data file (STATE.calendars), not in public code.

  function formatCalEvent(ev){
    if(!ev) return '';
    var s = ev.start || {}, e = ev.end || {};
    var days = ['יום א׳','יום ב׳','יום ג׳','יום ד׳','יום ה׳','יום ו׳','שבת'];
    if(s.dateTime){
      var sd = new Date(s.dateTime), ed = e.dateTime ? new Date(e.dateTime) : null;
      var dateLabel = sd.toLocaleDateString('he-IL', {day:'numeric', month:'numeric'});
      var t1 = sd.toLocaleTimeString('he-IL', {hour:'2-digit', minute:'2-digit'});
      var t2 = ed ? ed.toLocaleTimeString('he-IL', {hour:'2-digit', minute:'2-digit'}) : '';
      return days[sd.getDay()]+' '+dateLabel+' · '+t1+(t2?'–'+t2:'');
    } else if(s.date){
      var sd2 = new Date(s.date);
      var dateLabel2 = sd2.toLocaleDateString('he-IL', {day:'numeric', month:'numeric', timeZone:'UTC'});
      return days[sd2.getUTCDay()]+' '+dateLabel2+' (כל היום)';
    }
    return '';
  }

  var mcpNs = null, mcpTried = false;
  function getMcp(){
    if(mcpTried) return Promise.resolve(mcpNs);
    mcpTried = true;
    return claude.use('mcp').then(function(ns){ mcpNs = ns; return ns; }).catch(function(){ mcpNs = null; return null; });
  }

  function openCalLinkPanel(btn, t){
    var li = btn.closest('li');
    var existing = li.querySelector('.cal-panel');
    if(existing){ existing.remove(); return; }
    var panel = document.createElement('div');
    panel.className = 'cal-panel';
    panel.innerHTML =
      '<div class="cal-panel-row">'
      + '<select class="cal-sel"></select>'
      + '<input type="text" class="cal-q" placeholder="חיפוש חופשי (לא חובה)…" />'
      + '<button type="button" class="search">חפש</button>'
      + '<button type="button" class="cancel">ביטול</button>'
      + '</div>'
      + '<div class="cal-results"></div>';
    li.appendChild(panel);
    var sel = panel.querySelector('.cal-sel');
    (STATE.calendars || []).forEach(function(c){
      var opt = document.createElement('option');
      opt.value = c.id; opt.textContent = c.name;
      sel.appendChild(opt);
    });
    var qInp = panel.querySelector('.cal-q');
    var resultsEl = panel.querySelector('.cal-results');
    panel.querySelector('.cancel').addEventListener('click', function(){ panel.remove(); });
    var doSearch = function(){
      resultsEl.innerHTML = '<div class="cal-empty">מחפש…</div>';
      getMcp().then(function(mcp){
        if(!mcp){ resultsEl.innerHTML = '<div class="cal-empty">חיבור ליומן לא זמין כרגע בתצוגה הזו.</div>'; return; }
        var now = new Date();
        var later = new Date(now.getTime() + 180*24*3600*1000);
        var input = {
          calendarId: sel.value,
          startTime: now.toISOString(),
          endTime: later.toISOString(),
          orderBy: 'startTime',
          pageSize: 8
        };
        var q = qInp.value.trim();
        if(q) input.fullText = q;
        mcp.callTool('Google Calendar', 'list_events', input).then(function(res){
          var payload = res.payload || {};
          var events = payload.events || [];
          if(events.length === 0){
            resultsEl.innerHTML = '<div class="cal-empty">לא נמצאו אירועים תואמים בחצי השנה הקרובה.</div>';
            return;
          }
          resultsEl.innerHTML = '';
          events.forEach(function(ev){
            var row = document.createElement('div');
            row.className = 'cal-result-item';
            var label = document.createElement('span');
            label.textContent = (ev.summary || '(ללא כותרת)') + ' · ' + formatCalEvent(ev);
            var pickBtn = document.createElement('button');
            pickBtn.type = 'button';
            pickBtn.textContent = 'בחר';
            pickBtn.addEventListener('click', function(){
              t.cal = { calendarId: sel.value, eventId: ev.id };
              scheduleSave();
            });
            row.appendChild(label);
            row.appendChild(pickBtn);
            resultsEl.appendChild(row);
          });
        }).catch(function(err){
          var code = err && err.code ? err.code : 'שגיאה';
          resultsEl.innerHTML = '<div class="cal-empty">שגיאה בחיפוש ('+esc(code)+').</div>';
        });
      });
    };
    panel.querySelector('.search').addEventListener('click', doSearch);
    qInp.addEventListener('keydown', function(e){ if(e.key==='Enter'){ doSearch(); } });
  }

  var calWatchUnsubs = [];
  function clearCalWatches(){
    calWatchUnsubs.forEach(function(u){ try{ u(); }catch(e){} });
    calWatchUnsubs = [];
  }
  function bindCalWatches(){
    clearCalWatches();
    if(currentRoute() !== '#tasks') return;
    var linked = STATE.tasks.filter(function(t){ return t.cal && t.cal.calendarId && t.cal.eventId; });
    if(linked.length === 0) return;
    getMcp().then(function(mcp){
      if(!mcp) return;
      linked.forEach(function(t){
        var unsub = mcp.watchTool('Google Calendar', 'get_event', {calendarId: t.cal.calendarId, eventId: t.cal.eventId}, function(ev){
          var chipEl = document.querySelector('[data-calchip="'+t.id+'"]');
          if(!chipEl) return;
          var textEl = chipEl.querySelector('[data-caltext]');
          if(!textEl) return;
          if(ev.type === 'data'){
            var payload = ev.result.payload || {};
            textEl.textContent = formatCalEvent(payload) || (payload.summary || '');
            chipEl.classList.remove('stale');
          } else {
            var code = ev.error && ev.error.code;
            if(code==='needs_reauth' || code==='server_not_connected' || code==='blocked_by_policy' || code==='approval_required' || code==='not_in_manifest'){
              textEl.textContent = 'צריך להתחבר מחדש ליומן';
            }
            chipEl.classList.add('stale');
          }
        }, {refetchInterval: 300000});
        calWatchUnsubs.push(unsub);
      });
    });
  }

  /* ---------- HOME ---------- */
  function homeTasksCard(state){
    var urgent = state.tasks.filter(function(t){return t.urgent;});
    var html = '<a class="home-card" href="#tasks"><div class="hc-head"><h2>משימות</h2><span class="arrow">‹</span></div><div class="hc-body">';
    if(urgent.length===0){
      html += '<div class="hc-empty">אין משימות מסומנות כדחופות כרגע — סמן ⭑ בדף המלא כדי שיופיעו כאן.</div>';
    } else {
      urgent.slice(0,5).forEach(function(t){
        html += '<div class="hc-task-row"><span>'+esc(t.text)+'</span><span class="badge-urgent">דחוף</span></div>';
      });
    }
    html += '<div class="hc-task-row" style="margin-top:8px;color:var(--text-muted);font-size:12px;">סה״כ '+state.tasks.length+' משימות פתוחות</div>';
    html += '</div></a>';
    return html;
  }

  function homeFinanceCard(state){
    var f = state.finance;
    var html = '<a class="home-card" href="#finance"><div class="hc-head"><h2>פיננסים</h2><span class="arrow">‹</span></div><div class="hc-body">';
    html += '<div class="hc-fin-hero"><div class="hc-fin-total num">'+fmt(investmentsTotal(f))+'</div><div class="hc-fin-total-label">סה״כ בהשקעות — קצר, בינוני וארוך</div></div>';
    html += '<div class="hc-fin-split">';
    html += '<div class="hc-fin-split-item"><span class="l">טווח קצר</span><span class="v num">'+fmt(shortTotal(f))+'</span></div>';
    html += '<div class="hc-fin-split-item"><span class="l">טווח בינוני</span><span class="v num">'+fmt(mediumTotal(f))+'</span></div>';
    html += '<div class="hc-fin-split-item"><span class="l">טווח ארוך</span><span class="v num">'+fmt(longTotal(f))+'</span></div>';
    html += '</div>';
    html += '</div></a>';
    return html;
  }

  function uniquePeople(list){
    var seen = {}, out = [];
    list.forEach(function(d){
      if(!seen[d.person]){ seen[d.person] = true; out.push(d.person); }
    });
    return out;
  }

  function sumDebtAmount(list){
    var total = 0;
    list.forEach(function(d){
      var m = String(d.item).match(/([\d,]+)\s*₪/);
      if(m){ total += parseInt(m[1].replace(/,/g,''),10); }
    });
    return total;
  }

  function homeDebtsCard(state){
    var owes = state.debts.filter(function(d){return d.direction==='owes';});
    var owed = state.debts.filter(function(d){return d.direction==='owed';});
    var owesTotal = sumDebtAmount(owes);
    var owedTotal = sumDebtAmount(owed);
    var html = '<a class="home-card" href="#debts"><div class="hc-head"><h2>חובות והלוואות</h2><span class="arrow">‹</span></div><div class="hc-body">';
    html += '<div class="hc-debt-row"><span>שחר חייב</span><span class="v num">'+fmt(owesTotal)+'</span></div>';
    html += '<div class="hc-debt-row"><span>חייבים לשחר</span><span class="v num">'+fmt(owedTotal)+'</span></div>';
    html += '</div></a>';
    return html;
  }

  function homeSportsCard(state){
    var html = '<a class="home-card" href="#sports"><div class="hc-head"><h2>ספורט ואימונים</h2><span class="arrow">‹</span></div><div class="hc-body">';
    html += homeSportsMiniHTML(state);
    html += '</div></a>';
    return html;
  }

  function homeLeisureCard(state){
    var lz = state.leisure || {books:[],movies:[],travel:[],learning:[],cooking:[]};
    var html = '<a class="home-card" href="#leisure"><div class="hc-head"><h2>פנאי</h2><span class="arrow">‹</span></div><div class="hc-body">';
    html += '<div class="hc-task-row"><span>ספרים לקריאה</span><span class="v" style="font-family:\'Roboto Mono\',monospace;">'+(lz.books||[]).length+'</span></div>';
    html += '<div class="hc-task-row"><span>סרטים</span><span class="v" style="font-family:\'Roboto Mono\',monospace;">'+(lz.movies||[]).length+'</span></div>';
    html += '<div class="hc-task-row"><span>רעיונות לטיולים</span><span class="v" style="font-family:\'Roboto Mono\',monospace;">'+(lz.travel||[]).length+'</span></div>';
    html += '<div class="hc-task-row"><span>נושאים ללמידה</span><span class="v" style="font-family:\'Roboto Mono\',monospace;">'+(lz.learning||[]).length+'</span></div>';
    html += '<div class="hc-task-row"><span>מתכונים לבישול</span><span class="v" style="font-family:\'Roboto Mono\',monospace;">'+(lz.cooking||[]).length+'</span></div>';
    html += '</div></a>';
    return html;
  }

  function homeHTML(state){
    var now = new Date();
    var dateStr = now.toLocaleDateString('he-IL', {weekday:'long', day:'numeric', month:'long', year:'numeric'});
    var html = '';
    html += '<header class="top">';
    html += '<div><span class="eyebrow">מרכז בקרה אישי</span><h1>הדשבורד של שחר</h1><div class="sub">'+dateStr+'</div></div>';
    html += '</header>';
    html += '<div class="home-grid">';
    html += homeTasksCard(state);
    html += homeFinanceCard(state);
    html += homeDebtsCard(state);
    html += homeSportsCard(state);
    html += homeLeisureCard(state);
    html += homeDietCard(state);
    html += '</div>';
    html += '<footer class="foot">נבנה עבור שחר בורג · מתעדכן אוטומטית עם כל פעולה</footer>';
    return html;
  }

  /* ---------- CATEGORY ORDER ---------- */
  function getCategoryOrder(state){
    var present = {};
    state.tasks.forEach(function(t){ present[t.cat] = true; });
    var saved = (state.categoryOrder || []).filter(function(c){ return present[c]; });
    var seen = {};
    saved.forEach(function(c){ seen[c] = true; });
    state.tasks.forEach(function(t){
      if(!seen[t.cat]){ seen[t.cat] = true; saved.push(t.cat); }
    });
    return saved;
  }

  /* Reorders the tasks belonging to one category to match newOrderIds,
     leaving every other category's tasks in their existing relative
     positions untouched (drag-reorder within a category only). */
  function reorderCategoryTasks(cat, newOrderIds){
    var byId = {};
    STATE.tasks.forEach(function(t){ byId[t.id] = t; });
    var queue = newOrderIds.slice();
    STATE.tasks = STATE.tasks.map(function(t){
      if(t.cat === cat){
        var id = queue.shift();
        return byId[id] || t;
      }
      return t;
    });
  }

  function addExercise(dayId, name, setsReps){
    var d = STATE.sports.days.find(function(x){return x.id===dayId;});
    if(!d) return;
    d.exercises.push({
      name: name,
      setsReps: setsReps || '',
      lastWeight: null,
      lastDate: null,
      yt: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(name + ' tutorial')
    });
    scheduleSave();
  }

  function addWorkoutDay(name){
    if(!STATE.sports.days) STATE.sports.days = [];
    STATE.sports.days.push({id:'day_'+Date.now()+'_'+Math.floor(Math.random()*1000), name:name, lastDone:null, exercises:[]});
    scheduleSave();
  }

  // Removes a whole workout type. Its past workoutLog entries stay (they keep their own dayName),
  // so the 14-day graph doesn't lose history.
  function deleteWorkoutDay(dayId){
    STATE.sports.days = (STATE.sports.days||[]).filter(function(d){ return d.id!==dayId; });
    scheduleSave();
  }

  function deleteExercise(dayId, idx){
    var d = STATE.sports.days.find(function(x){return x.id===dayId;});
    if(!d) return;
    d.exercises.splice(idx, 1);
    scheduleSave();
  }

  /* Keeps a day's "lastDone" label in sync with its most recent workoutLog
     entry, so fixing/adding/deleting a log entry also fixes what the day
     card shows — without this, editing the log alone could leave a stale
     "בוצע לאחרונה" date behind. */
  function refreshDayLastDone(dayId){
    var d = STATE.sports.days.find(function(x){return x.id===dayId;});
    if(!d) return;
    var entries = (STATE.sports.workoutLog||[]).filter(function(w){return w.dayId===dayId;});
    if(entries.length === 0){ d.lastDone = null; return; }
    var latest = null, latestTime = -Infinity;
    entries.forEach(function(w){
      var dt = parseHeDate(w.date);
      if(!dt) return;
      if(dt.getTime() > latestTime){ latestTime = dt.getTime(); latest = w; }
    });
    if(latest) d.lastDone = latest.date;
  }

  function addWorkoutLogEntry(dayId, dateStr){
    var d = STATE.sports.days.find(function(x){return x.id===dayId;});
    if(!d) return;
    if(!STATE.sports.workoutLog) STATE.sports.workoutLog = [];
    STATE.sports.workoutLog.push({id:'wl_'+Date.now()+'_'+Math.floor(Math.random()*1000), dayId:d.id, dayName:d.name, date:dateStr});
    refreshDayLastDone(d.id);
    scheduleSave();
  }

  function deleteWorkoutLogEntry(id){
    var entry = (STATE.sports.workoutLog||[]).find(function(w){return w.id===id;});
    STATE.sports.workoutLog = (STATE.sports.workoutLog||[]).filter(function(w){return w.id!==id;});
    if(entry) refreshDayLastDone(entry.dayId);
    scheduleSave();
  }

  function updateWorkoutLogDate(id, dateStr){
    var w = (STATE.sports.workoutLog||[]).find(function(x){return x.id===id;});
    if(!w) return;
    w.date = dateStr;
    refreshDayLastDone(w.dayId);
    scheduleSave();
  }

  /* Drops workoutLog entries older than the graph's 14-day window — Shahar asked
     not to bother keeping older entries around. Deliberately does NOT touch
     d.lastDone: that field should still reflect the true last time a day was
     done even once its log entry has aged out of the 14-day window, so this is
     a plain filter on workoutLog only, never routed through refreshDayLastDone.
     Returns true if anything was actually removed, so the caller can skip an
     unnecessary save/publish when there was nothing to prune. */
  function pruneOldWorkoutLog(){
    var log = STATE.sports.workoutLog;
    if(!log || !log.length) return false;
    var cutoff = new Date(); cutoff.setHours(0,0,0,0);
    cutoff.setDate(cutoff.getDate() - 13); // keep today + 13 previous days = 14-day window
    var kept = log.filter(function(w){
      var dt = parseHeDate(w.date);
      return !dt || dt.getTime() >= cutoff.getTime();
    });
    if(kept.length === log.length) return false;
    STATE.sports.workoutLog = kept;
    return true;
  }

  /* ---------- TASKS PAGE ---------- */
  function tasksPageHTML(state){
    var order = getCategoryOrder(state);
    var byCat = {};
    order.forEach(function(c){ byCat[c] = []; });
    state.tasks.forEach(function(t){
      if(!byCat[t.cat]) byCat[t.cat] = [];
      byCat[t.cat].push(t);
    });
    var html = backLink();
    html += '<div class="page-head"><h1>משימות</h1><div class="sub">'+state.tasks.length+' משימות פתוחות</div><div class="sub help">סמן וי כדי לסמן כבוצעה (מוסרת לצמיתות) · סמן ⭑ כדי שתופיע כ״דחוף״ בדף הבית ותעלה אוטומטית לראש הקטגוריה · לחיצה על טקסט המשימה עורכת אותו במקום (Enter לשמירה, Esc לביטול) · 📅 קושר משימה לאירוע ביומן Google ומציג את הזמן שלו בזמן אמת (לא כל משימה חייבת) · בצד ההערה אפשר לרשום קישור או הערה חופשית · גררו את כותרת הקטגוריה (⠿) כדי לשנות את סדר הקטגוריות, וגררו את הידית שליד כל משימה כדי לשנות את סדרה בתוך הקטגוריה</div></div>';
    html += '<div class="panel">';
    html += '<div class="add-task-panel"><div class="add-task-row">'
          + '<input type="text" name="txt" placeholder="משימה חדשה…" />'
          + '<input type="text" name="cat" placeholder="קטגוריה (למשל: כללי)" list="cat-datalist" />'
          + '<button data-action="addtask">+ הוסף משימה</button>'
          + '</div><datalist id="cat-datalist">'
          + order.map(function(c){return '<option value="'+esc(c)+'">';}).join('')
          + '</datalist></div>';
    html += '<div class="panel-body" id="tasks-cat-list">';
    if(state.tasks.length===0){
      html += '<div class="hc-empty" style="padding:18px;">אין משימות פתוחות כרגע 🎉</div>';
    }
    order.forEach(function(cat){
      html += '<div class="task-cat-group" data-cat="'+esc(cat)+'">';
      html += '<div class="task-cat"><span class="drag-hint" aria-hidden="true">⠿</span><span class="cat-name">'+esc(cat)+'</span></div>';
      html += '<ul class="tasks task-list">';
      byCat[cat].forEach(function(t){
        // .task-actions and .cat-move are display:contents on desktop (layout
        // unchanged); on phones they turn into a compact icon cluster so the
        // task text gets most of the row width.
        html += '<li data-task="'+t.id+'">'
              + '<span class="task-drag-handle" aria-hidden="true">⠿</span>'
              + '<input type="checkbox" data-action="done" data-task="'+t.id+'" />'
              + '<span class="txt inline-edit" contenteditable="plaintext-only" dir="rtl" spellcheck="false" data-inline="tasktext" data-task="'+t.id+'" data-ph="טקסט המשימה">'+esc(t.text)+'</span>'
              + '<span class="task-actions">'
              + '<span class="cat-move"><span class="cat-move-icon" aria-hidden="true">⇄</span>'
              + '<select class="cat-select" data-action="movecat" data-task="'+t.id+'" title="העבר לקטגוריה אחרת">'
              + order.map(function(c){return '<option value="'+esc(c)+'" '+(c===t.cat?'selected':'')+'>'+esc(c)+'</option>';}).join('')
              + '<option value="__new__">+ קטגוריה חדשה…</option>'
              + '</select></span>'
              + '<button class="star-btn '+(t.urgent?'on':'')+'" data-action="urgent" data-task="'+t.id+'" title="סמן כדחוף">'+(t.urgent?'★':'☆')+'</button>'
              + (t.cal ? '' : '<button type="button" class="cal-btn" data-action="callink" data-task="'+t.id+'" title="קשר לאירוע ביומן">📅</button>')
              + (t.note && /^https?:\/\//i.test(t.note) ? '<a class="note-link" href="'+esc(t.note)+'" target="_blank" rel="noopener" title="פתח קישור">🔗</a>' : '')
              + '</span>'
              + (t.cal ? '<span class="cal-linked" data-calchip="'+t.id+'"><span data-caltext>טוען…</span><button type="button" class="unlink" data-action="calunlink" data-task="'+t.id+'" title="בטל קישור ליומן">✕</button></span>' : '')
              + '<input type="text" class="note-input" data-action="note" data-task="'+t.id+'" placeholder="הערה / קישור…" value="'+esc(t.note||'')+'" />'
              + '</li>';
      });
      html += '</ul></div>';
    });
    html += '</div></div>';
    return html;
  }

  /* ---------- FINANCE PAGE (dark board, Geckoboard-style) ----------
     Numbers first, words last: KPI tiles and charts on top, the reasoning
     behind the investments in one section at the bottom. Details that are
     rarely needed (policy numbers, fees, sources) sit in <details>. */
  var FB = { cyan:'#19c3f5', teal:'#4fe3c1', yellow:'#f2c94c', magenta:'#c86be8', blue:'#6c8cff', orange:'#ff9f43', grid:'rgba(255,255,255,0.07)' };
  var FB_TICKER = { QQQ:FB.cyan, NVDA:FB.teal, IBIT:FB.yellow, AINT:FB.magenta, SPY:'#ffffff', DTCR:FB.orange, TATECH:FB.blue };

  function fmtK(n){
    var neg = n < 0, a = Math.abs(n), s;
    if(a >= 1e6) s = (a/1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/,'') + 'M';
    else if(a >= 1e4) s = Math.round(a/1e3) + 'K';
    else if(a >= 1e3) s = (a/1e3).toFixed(1).replace(/\.0$/,'') + 'K';
    else s = String(Math.round(a));
    return '<span class="fb-money" dir="ltr">'+(neg?'−':'')+'₪'+s+'</span>';
  }
  function pctHTML(p, digits){
    if(p == null || isNaN(p)) return '<span class="fb-pct flat">—</span>';
    var cls = p > 0.004 ? 'up' : (p < -0.004 ? 'down' : 'flat');
    return '<span class="fb-pct '+cls+'" dir="ltr">'+(p>0?'▲ +':(p<0?'▼ ':''))+p.toFixed(digits==null?2:digits)+'%</span>';
  }
  function fbBadge(kind){
    return kind==='ok' ? '<span class="fb-badge ok" aria-label="תקין">✓</span>' : '<span class="fb-badge bad" aria-label="דורש תשומת לב">!</span>';
  }
  function fbTile(cls, title, body, extra){
    return '<section class="fb-tile '+(cls||'')+'">'+(title?'<h3 class="fb-title">'+title+(extra||'')+'</h3>':'')+body+'</section>';
  }

  /* Line chart of % change since each series' first point. Pure SVG, works offline. */
  function fbLineChart(history, tickers){
    var W = 640, H = 230, L = 46, R = 12, T = 12, B = 26;
    var series = tickers.map(function(tk){
      var base = null, pts = [];
      history.forEach(function(h, i){
        var p = h.prices ? h.prices[tk] : null;
        if(p == null) return;
        if(base == null) base = p;
        pts.push({i:i, v:(p/base - 1)*100});
      });
      return {tk:tk, pts:pts};
    }).filter(function(s){ return s.pts.length > 1; });
    if(!series.length) return '<div class="fb-empty">אין עדיין היסטוריית מחירים</div>';
    var min = 0, max = 0;
    series.forEach(function(s){ s.pts.forEach(function(p){ if(p.v<min) min=p.v; if(p.v>max) max=p.v; }); });
    var step = Math.max(5, Math.ceil((max-min)/4/5)*5);
    min = Math.floor(min/step)*step; max = Math.ceil(max/step)*step; if(max===min) max = min+step;
    var n = history.length;
    var x = function(i){ return L + (W-L-R) * (n>1 ? i/(n-1) : 0); };
    var y = function(v){ return T + (H-T-B) * (1 - (v-min)/(max-min)); };
    var svg = '<svg class="fb-chart" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="תשואה מצטברת לפי נייר">';
    for(var g = min; g <= max + 0.001; g += step){
      svg += '<line x1="'+L+'" x2="'+(W-R)+'" y1="'+y(g)+'" y2="'+y(g)+'" stroke="'+(g===0?'rgba(255,255,255,0.25)':FB.grid)+'" />';
      svg += '<text x="'+(L-8)+'" y="'+(y(g)+4)+'" text-anchor="end" class="fb-axis">'+(g>0?'+':'')+g+'%</text>';
    }
    [0, Math.floor((n-1)/2), n-1].forEach(function(i){
      var d = String(history[i].date||'').split('.');
      svg += '<text x="'+x(i)+'" y="'+(H-6)+'" text-anchor="'+(i===0?'start':(i===n-1?'end':'middle'))+'" class="fb-axis">'+esc(d[0]+'.'+d[1])+'</text>';
    });
    series.forEach(function(s){
      var c = FB_TICKER[s.tk] || FB.blue;
      var dpath = s.pts.map(function(p, j){ return (j?'L':'M')+x(p.i).toFixed(1)+' '+y(p.v).toFixed(1); }).join(' ');
      svg += '<path d="'+dpath+'" fill="none" stroke="'+c+'" stroke-width="'+(s.tk==='SPY'?2:2.4)+'"'+(s.tk==='SPY'?' stroke-dasharray="5 4" opacity="0.85"':'')+' stroke-linejoin="round" stroke-linecap="round"/>';
      var last = s.pts[s.pts.length-1];
      svg += '<circle cx="'+x(last.i)+'" cy="'+y(last.v)+'" r="3.2" fill="'+c+'"/>';
    });
    svg += '</svg>';
    var legend = '<div class="fb-legend">' + series.map(function(s){
      var last = s.pts[s.pts.length-1].v;
      return '<span><i style="background:'+(FB_TICKER[s.tk]||FB.blue)+'"></i>'+esc(s.tk==='SPY'?'S&P 500':s.tk)+' <b dir="ltr">'+(last>=0?'+':'')+last.toFixed(1)+'%</b></span>';
    }).join('') + '</div>';
    return legend + '<div class="fb-chart-wrap">'+svg+'</div>';
  }

  function fbDonut(segs, centerTop, centerSub){
    var total = segs.reduce(function(a,s){ return a+s.v; }, 0) || 1;
    var r = 52, c = 2*Math.PI*r, off = 0;
    var svg = '<svg class="fb-donut" viewBox="0 0 140 140" aria-hidden="true"><g transform="rotate(-90 70 70)">';
    svg += '<circle cx="70" cy="70" r="'+r+'" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="16"/>';
    segs.forEach(function(s){
      var len = c * s.v/total;
      svg += '<circle cx="70" cy="70" r="'+r+'" fill="none" stroke="'+s.color+'" stroke-width="16" stroke-dasharray="'+Math.max(0,len-1.5).toFixed(2)+' '+(c-len+1.5).toFixed(2)+'" stroke-dashoffset="'+(-off).toFixed(2)+'"/>';
      off += len;
    });
    svg += '</g></svg>';
    return '<div class="fb-donut-wrap">'+svg+'<div class="fb-donut-center"><div class="fb-donut-top">'+centerTop+'</div><div class="fb-donut-sub">'+centerSub+'</div></div></div>';
  }

  function fbSplitBar(segs){
    var total = segs.reduce(function(a,s){ return a+s.v; }, 0) || 1;
    return '<div class="fb-split">'+segs.map(function(s){
      return s.v>0 ? '<i style="width:'+(s.v/total*100).toFixed(2)+'%;background:'+s.color+'"></i>' : '';
    }).join('')+'</div>'
      + '<div class="fb-split-legend">'+segs.map(function(s){
      return '<div><span><i style="background:'+s.color+'"></i>'+esc(s.label)+'</span>'+fmtK(s.v)+'</div>';
    }).join('')+'</div>';
  }

  function fbDetails(rows, label){
    rows = rows.filter(function(r){ return r && r[1] != null && r[1] !== ''; });
    if(!rows.length) return '';
    return '<details class="fb-more"><summary>'+(label||'פרטים')+'</summary>'+rows.map(function(r){
      return '<div class="fb-more-row"><span>'+esc(r[0])+'</span><span>'+esc(r[1])+'</span></div>';
    }).join('')+'</details>';
  }

  /* ---------- SPENDING (monthly analysis of bank + card statements, written by Claude) ----------
     finance.spending = { asOf, source,
       months:   [{ id:'2026-09', label:'ספט׳', total, byCat:{ 'סופר': 1800, ... } }]   (oldest → newest)
       insights: [{ title, text, saving }]      saving = ₪ per month
       trends:   [{ text, dir:'up'|'down'|'flat' }]
       cashflow: [{ label, income, out }]       optional: money in vs out per month (bank level)
       cashflowNote: '...' } */
  var SP_COLORS = [FB.cyan, FB.magenta, FB.yellow, FB.teal, FB.blue, FB.orange];
  function spendingHTML(f){
    var sp = f.spending;
    var html = '<div class="fb-subhead fb-span12"><h2>הוצאות</h2>'+(sp&&sp.asOf?'<span class="fb-asof">נותח '+esc(sp.asOf)+'</span>':'')+'</div>';
    if(!sp || !sp.months || !sp.months.length){
      return html + fbTile('fb-span12', '', '<div class="fb-empty">עוד אין ניתוח. שלח ל-Claude את תדפיסי הבנק והאשראי של החודש, והוא יוסיף כאן את המגמות ואיפה אפשר לחסוך.</div>');
    }
    var months = sp.months.slice(-6), cur = months[months.length-1], prev = months.slice(0,-1).slice(-3);
    var avg = prev.length ? prev.reduce(function(a,m){ return a+(m.total||0); },0)/prev.length : null;
    var vsAvg = avg ? ((cur.total||0)/avg - 1)*100 : null;
    var saving = (sp.insights||[]).reduce(function(a,x){ return a+(x.status==='keep'?0:(x.saving||0)); }, 0);
    // categories: biggest across the shown months first; the rest go to "אחר"
    var catTot = {};
    months.forEach(function(m){ Object.keys(m.byCat||{}).forEach(function(c){ catTot[c] = (catTot[c]||0) + m.byCat[c]; }); });
    var cats = Object.keys(catTot).sort(function(a,b){ return catTot[b]-catTot[a]; });
    var top = cats.slice(0,6), color = {};
    top.forEach(function(c,i){ color[c] = SP_COLORS[i]; });
    var topCur = Object.keys(cur.byCat||{}).sort(function(a,b){ return cur.byCat[b]-cur.byCat[a]; })[0];

    html += fbTile('fb-span3 fb-kpi', 'הוצאה · '+esc(cur.label||cur.id),
        '<div class="fb-kpi-n fb-big2">'+fmtK(cur.total||0)+'</div><div class="fb-kpi-sub">'+(vsAvg==null?'חודש ראשון שנותח':'מול ממוצע '+prev.length+' חודשים ')+(vsAvg==null?'':'<span class="fb-pct '+(vsAvg>0.5?'down':(vsAvg<-0.5?'up':'flat'))+'" dir="ltr">'+(vsAvg>0?'+':'')+vsAvg.toFixed(0)+'%</span>')+'</div>'
      + (vsAvg!=null && vsAvg>10 ? fbBadge('bad') : ''));
    html += fbTile('fb-span3 fb-kpi', 'ממוצע חודשי',
        '<div class="fb-kpi-n fb-big2">'+fmtK(avg==null?(cur.total||0):avg)+'</div><div class="fb-kpi-sub">'+(prev.length||1)+' חודשים אחרונים</div>');
    html += fbTile('fb-span3 fb-kpi', 'אפשר לחסוך',
        '<div class="fb-kpi-n fb-big2"><span class="fb-pct up" dir="ltr">₪'+Math.round(saving).toLocaleString('en-US')+'</span></div><div class="fb-kpi-sub">בחודש · כ-'+fmtK(saving*12)+' בשנה</div>' + (saving>0?fbBadge('ok'):''));
    html += fbTile('fb-span3 fb-kpi', 'הקטגוריה הגדולה',
        '<div class="fb-kpi-n fb-big2" style="font-size:24px">'+esc(topCur||'—')+'</div><div class="fb-kpi-sub">'+(topCur?fmtK(cur.byCat[topCur])+' · '+Math.round(cur.byCat[topCur]/(cur.total||1)*100)+'% מההוצאה':'')+'</div>');

    // stacked bars per month
    var W = 640, H = 230, L = 46, R = 8, T = 10, B = 26;
    var max = Math.max.apply(null, months.map(function(m){ return m.total||0; })) || 1;
    var step = Math.pow(10, Math.floor(Math.log10(max))) / 2; while(max/step > 5) step *= 2;
    var top2 = Math.ceil(max/step)*step;
    var y = function(v){ return T + (H-T-B)*(1 - v/top2); };
    var bw = Math.min(56, (W-L-R)/months.length*0.55);
    var svg = '<svg class="fb-chart" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="הוצאה חודשית לפי קטגוריה">';
    for(var g=0; g<=top2+0.1; g+=step){
      svg += '<line x1="'+L+'" x2="'+(W-R)+'" y1="'+y(g)+'" y2="'+y(g)+'" stroke="'+FB.grid+'"/><text x="'+(L-8)+'" y="'+(y(g)+4)+'" text-anchor="end" class="fb-axis">'+(g>=1000?(g/1000)+'K':g)+'</text>';
    }
    months.forEach(function(m, i){
      var cx = L + (W-L-R)*(i+0.5)/months.length, base = 0;
      var parts = top.map(function(c){ return {c:c, v:(m.byCat||{})[c]||0}; });
      var other = (m.total||0) - parts.reduce(function(a,p){ return a+p.v; },0);
      parts.push({c:'אחר', v:Math.max(0,other)});
      parts.forEach(function(p){
        if(p.v<=0) return;
        svg += '<rect x="'+(cx-bw/2)+'" y="'+y(base+p.v)+'" width="'+bw+'" height="'+(y(base)-y(base+p.v))+'" fill="'+(color[p.c]||'#5b5e94')+'"><title>'+esc(p.c)+' ₪'+Math.round(p.v)+'</title></rect>';
        base += p.v;
      });
      svg += '<text x="'+cx+'" y="'+(H-6)+'" text-anchor="middle" class="fb-axis">'+esc(m.label||m.id)+'</text>';
    });
    svg += '</svg>';
    var legend = '<div class="fb-legend">'+top.concat(['אחר']).map(function(c){ return '<span><i style="background:'+(color[c]||'#5b5e94')+'"></i>'+esc(c)+'</span>'; }).join('')+'</div>';
    html += fbTile('fb-span7', 'הוצאה חודשית לפי קטגוריה', legend + '<div class="fb-chart-wrap">'+svg+'</div>');

    // this month by category vs average
    var cmax = Math.max.apply(null, Object.keys(cur.byCat||{}).map(function(c){ return cur.byCat[c]; })) || 1;
    var rows = Object.keys(cur.byCat||{}).sort(function(a,b){ return cur.byCat[b]-cur.byCat[a]; }).slice(0,8).map(function(c){
      var v = cur.byCat[c], pv = prev.filter(function(m){ return m.byCat && m.byCat[c]!=null; });
      var a = pv.length ? pv.reduce(function(s,m){ return s+m.byCat[c]; },0)/pv.length : null;
      var d = a ? (v/a-1)*100 : null;
      return '<div class="fb-cat"><span class="fb-cat-l"><i style="background:'+(color[c]||'#5b5e94')+'"></i>'+esc(c)+'</span>'
        + '<div class="fb-bar"><i style="width:'+(v/cmax*100).toFixed(1)+'%;background:'+(color[c]||'#5b5e94')+'"></i></div>'
        + '<span class="fb-cat-v">'+fmtK(v)+'</span><span class="fb-cat-d">'+(d==null?'':'<span class="fb-pct '+(d>5?'down':(d<-5?'up':'flat'))+'" dir="ltr">'+(d>0?'+':'')+d.toFixed(0)+'%</span>')+'</span></div>';
    }).join('');
    html += fbTile('fb-span5', esc(cur.label||cur.id)+' · מול הממוצע', rows);

    // where to save + trends
    var ins = (sp.insights||[]).slice().sort(function(a,b){ return ((b.alert?1e9:0)+(b.saving||0))-((a.alert?1e9:0)+(a.saving||0)); }).map(function(x){
      return '<div class="fb-ins'+(x.alert?' alert':'')+(x.status==='done'?' done':'')+'"><div class="fb-ins-top"><b>'+(x.alert?'<span class="fb-badge-inline">!</span>':'')+esc(x.title||'')+(x.status?' <span class="fb-status '+esc(x.status)+'">'+({done:'בוצע',doing:'בטיפול',check:'לבדוק',keep:'הוחלט להשאיר'}[x.status]||esc(x.status))+'</span>':'')+'</b>'+(x.saving?'<span class="fb-save"><span dir="ltr">₪'+Math.round(x.saving).toLocaleString('en-US')+'</span> בחודש</span>':'')+'</div>'+(x.text?'<div class="fb-ins-t">'+esc(x.text)+'</div>':'')+'</div>';
    }).join('') || '<div class="fb-empty">אין המלצות החודש</div>';
    var cf = sp.cashflow || [];
    if(cf.length){
      var cmax2 = Math.max.apply(null, cf.map(function(m){ return Math.max(m.income||0, m.out||0); })) || 1;
      var cfRows = cf.map(function(m){
        var net = (m.income||0) - (m.out||0);
        return '<div class="fb-cf"><div class="fb-cf-top"><b>'+esc(m.label||'')+'</b><span class="fb-pct '+(net>=0?'up':'down')+'" dir="ltr">'+(net>=0?'+':'−')+'₪'+Math.abs(Math.round(net)).toLocaleString('en-US')+'</span></div>'
          + '<div class="fb-cf-bar"><span>נכנס</span><div class="fb-bar"><i style="width:'+((m.income||0)/cmax2*100).toFixed(1)+'%;background:'+FB.cyan+'"></i></div><span class="fb-money" dir="ltr">₪'+Math.round(m.income||0).toLocaleString('en-US')+'</span></div>'
          + '<div class="fb-cf-bar"><span>יצא</span><div class="fb-bar"><i style="width:'+((m.out||0)/cmax2*100).toFixed(1)+'%;background:'+FB.yellow+'"></i></div><span class="fb-money" dir="ltr">₪'+Math.round(m.out||0).toLocaleString('en-US')+'</span></div></div>';
      }).join('');
      html += fbTile('fb-span5', 'תזרים בעו״ש', cfRows + (sp.cashflowNote?'<div class="fb-rule">'+esc(sp.cashflowNote)+'</div>':''));
    }
    html += fbTile('fb-span7', 'איפה אפשר לחסוך', ins);
    // Pie charts instead of words: where the money went this month, on average, and routine vs one-off.
    var ONE_OFF = {'חופשות וטיולים':1, 'מתנות ואירועים':1, 'אלקטרוניקה':1, 'בית ושיפוצים':1};
    var pieOf = function(byCat){
      var segs = top.map(function(c){ return {label:c, v:byCat[c]||0, color:color[c]}; });
      var rest = Object.keys(byCat).filter(function(c){ return !color[c]; }).reduce(function(a,c){ return a+byCat[c]; }, 0);
      if(rest>0) segs.push({label:'אחר', v:rest, color:'#5b5e94'});
      return segs.filter(function(x){ return x.v>0; });
    };
    var pieTile = function(title, segs, center, sub){
      var tot = segs.reduce(function(a,x){ return a+x.v; }, 0) || 1;
      return fbTile('fb-span4 fb-pie', title, fbDonut(segs, center, sub)
        + '<div class="fb-split-legend">'+segs.map(function(x){ return '<div><span><i style="background:'+x.color+'"></i>'+esc(x.label)+'</span><span dir="ltr">'+Math.round(x.v/tot*100)+'%</span></div>'; }).join('')+'</div>');
    };
    var avgCat = {};
    months.forEach(function(m){ Object.keys(m.byCat||{}).forEach(function(c){ avgCat[c] = (avgCat[c]||0) + m.byCat[c]/months.length; }); });
    var avgTot = Object.keys(avgCat).reduce(function(a,c){ return a+avgCat[c]; }, 0);
    var oneOff = 0, routine = 0;
    months.forEach(function(m){ Object.keys(m.byCat||{}).forEach(function(c){ if(ONE_OFF[c]) oneOff += m.byCat[c]; else routine += m.byCat[c]; }); });
    var k = function(v){ return '<span dir="ltr">₪'+(v>=1000?(v/1000).toFixed(1).replace(/\.0$/,'')+'K':Math.round(v))+'</span>'; };
    html += pieTile(esc(cur.label||cur.id)+' · לפי קטגוריה', pieOf(cur.byCat||{}), k(cur.total||0), 'החודש');
    html += pieTile('ממוצע '+months.length+' חודשים', pieOf(avgCat), k(avgTot), 'בחודש');
    html += pieTile('שוטף מול חד-פעמי', [{label:'שוטף', v:routine, color:FB.cyan},{label:'חד-פעמי (טיולים, מתנות, ציוד, בית)', v:oneOff, color:FB.yellow}], '<span dir="ltr">'+Math.round(oneOff/((oneOff+routine)||1)*100)+'%</span>', 'חד-פעמי');
    if((sp.trends||[]).length || sp.source){
      html += '<div class="fb-span12">' + fbDetails((sp.trends||[]).map(function(t){ return [(t.dir==='up'?'▲':(t.dir==='down'?'▼':'●')), t.text||'']; }).concat(sp.source?[['מקור', sp.source]]:[]), 'מגמות במילים') + '</div>';
    }
    return html;
  }

  function financePageHTML(state){
    var f = state.finance || {};
    var lt = f.longTerm || {}, sm = f.shortMedium || {}, re = f.realEstate, pl = f.plan;
    var bank = sm.bank || {securities:0, securitiesBreakdown:[]}, ib = sm.ibkr || {holdings:[]};
    var fx = ib.fxUsdIls || 0, cashIls = (ib.cashUsd||0) * fx;
    var shortV = shortTotal(f), medV = mediumTotal(f), longV = longTotal(f), invV = shortV + medV + longV;

    // securities (Israel + abroad) as one list
    var hold = (bank.securitiesBreakdown||[]).map(function(x){
      return {name:x.label, tk:null, v:x.value||0, gain:x.gainPct, day:x.changePct, where:'ישראל'};
    }).concat((ib.holdings||[]).map(function(h){
      return {name:h.name, tk:h.ticker, v:h.valueIls||0, gain:h.gainPct, day:h.changePct, where:'חו״ל'};
    }));
    var secV = hold.reduce(function(a,h){ return a+h.v; }, 0);
    var g = gainAgg(hold.map(function(h){ return {v:h.v, gainPct:h.gain, changePct:h.day}; }), 'v');

    // real estate
    var reMid = 0, reEquity = 0, reMonths = 0, reSpent = 0;
    if(re){
      reMid = ((re.currentEstLow||0) + (re.currentEstHigh||0)) / 2;
      reEquity = reMid - (re.mortgage||0);
      reMonths = reMonthsSincePurchase(re.purchaseDate);
      var oc = re.oneTimeCosts || {};
      reSpent = (oc.general||0) + (oc.contractor||0) + (oc.selfRenovation||0) + reMonths * Math.abs(re.monthlyNet||0);
    }
    var loanV = f.loan ? (f.loan.amount||0) : 0;
    var netWorth = invV + reEquity - loanV;

    // the S&P-tracking funds (pension, study fund, gemel x2)
    var an = sm.analystGemel;
    var funds = [
      {name:'פנסיה — הראל', o:lt.pension, ret:lt.pension&&lt.pension.return, color:FB.cyan, term:'ארוך'},
      {name:'קרן השתלמות', o:sm.studyFund, ret:sm.studyFund&&sm.studyFund.return, color:FB.teal, term:'ארוך'},
      {name:'גמל להשקעה — אנליסט', o:an, ret:an&&an.tracks&&an.tracks[0]&&an.tracks[0].return, color:FB.magenta, term:'בינוני'},
      {name:'קופת תגמולים — מנורה', o:lt.menorahGemel, ret:lt.menorahGemel&&lt.menorahGemel.return, color:FB.yellow, term:'ארוך'}
    ].filter(function(x){ return x.o; });
    var fw = 0, fy = 0, fTot = 0;
    funds.forEach(function(x){ fTot += x.o.value||0; if(x.ret && x.ret.y1!=null){ fw += x.o.value; fy += x.o.value * x.ret.y1; } });
    var fundsY1 = fw ? fy/fw : null;

    var html = backLink();
    html += '<div class="fb">';
    html += '<div class="fb-head"><h1>פיננסים</h1><span class="fb-asof">נכון ל-'+esc(state.asOf||'')+'</span></div>';
    // Standing principle (Shahar, 06.11.2026): monthly money is never invested on autopilot.
    html += '<div class="fb-principle" role="note"><b>עיקרון: לא משקיעים אוטומטית</b>'
      + '<span>בכל חודש, כשהכסף נכנס: קודם בודקים במדדים מה נמצא נמוך, ורק אז מחליטים לאן להכניס את הכסף. תוכנית הקנייה למטה היא כיוון, לא הוראה אוטומטית.</span></div>';
    html += '<div class="fb-grid">';

    // ===== Row 1: total + performance chart
    html += fbTile('fb-span5 fb-hero', '',
        '<div class="fb-hero-label">סך ההשקעות</div>'
      + '<div class="fb-big">'+fmtK(invV)+'</div>'
      + fbSplitBar([{label:'טווח ארוך', v:longV, color:FB.cyan},{label:'טווח בינוני', v:medV, color:FB.magenta},{label:'טווח קצר', v:shortV, color:FB.yellow}])
      + '<div class="fb-hero-foot"><span>שווי נקי משוער (כולל נדל״ן, פחות הלוואות)</span>'+fmtK(netWorth)+'</div>');
    html += fbTile('fb-span7', 'ני״ע בחו״ל מול S&P 500', fbLineChart(ib.priceHistory||[], ['QQQ','NVDA','AINT','IBIT','SPY']), '<span class="fb-title-note">שינוי מצטבר מתחילת המעקב</span>');

    // ===== Row 2: securities (the headline), then KPIs
    var ilV = (bank.securitiesBreakdown||[]).reduce(function(a,x){ return a+(x.value||0); }, 0);
    html += fbTile('fb-span6', 'ני״ע · אוצר החייל',
        '<div class="fb-sec-top"><div class="fb-sec-n"><span class="fb-money" dir="ltr">₪'+Math.round(secV).toLocaleString('en-US')+'</span></div>'
      + '<div class="fb-sec-stats"><div><div class="fb-kpi-sub">מאז קנייה</div>'+pctHTML(g.gainPct)+'</div><div><div class="fb-kpi-sub">היום</div>'+pctHTML(g.dailyPct)+'</div></div></div>'
      + '<div class="fb-kpi-sub">'+(g.gain>=0?'רווח ':'הפסד ')+fmtK(g.gain)+' מאז קנייה</div>'
      + '<div class="fb-sec-split">'+fbSplitBar([{label:'ישראל', v:ilV, color:FB.blue},{label:'חו״ל', v:secV-ilV, color:FB.cyan}])+'</div>'
      + fbBadge(g.gain>=0?'ok':'bad'));
    html += fbTile('fb-span3 fb-kpi', 'קופות S&P · שנה',
        '<div class="fb-kpi-n">'+pctHTML(fundsY1, 1)+'</div><div class="fb-kpi-sub">משוקלל · '+fmtK(fTot)+'</div>');
    if(re){
      var neg = (re.monthlyNet||0) < 0;
      html += fbTile('fb-span3 fb-kpi', 'נדל״ן · תזרים חודשי',
          '<div class="fb-kpi-n"><span class="fb-pct '+(neg?'down':'up')+'" dir="ltr">'+(neg?'−':'+')+'₪'+Math.abs(re.monthlyNet||0).toLocaleString('en-US')+'</span></div><div class="fb-kpi-sub">שכ״ד מול משכנתא</div>' + fbBadge(neg?'bad':'ok'));
    }

    // ===== Row 3: holdings + funds
    var hRows = hold.slice().sort(function(a,b){ return b.v-a.v; }).map(function(h){
      var w = secV ? h.v/secV*100 : 0;
      var color = h.tk ? (FB_TICKER[h.tk]||FB.blue) : FB.blue;
      return '<tr><td class="fb-h-name"><b>'+esc(h.tk || h.name.replace(/^(קרן מחקה מדד|ETF מחקה מדד) /,'').replace(/ — .*$/,''))+'</b><span>'+esc(h.tk ? h.name : 'ישראל')+'</span></td>'
        + '<td class="fb-h-w"><div class="fb-bar"><i style="width:'+w.toFixed(1)+'%;background:'+color+'"></i></div><span dir="ltr">'+w.toFixed(0)+'%</span></td>'
        + '<td class="fb-h-v">'+fmtK(h.v)+'</td><td class="fb-h-p">'+pctHTML(h.gain,1)+'</td><td class="fb-h-p fb-dim">'+pctHTML(h.day)+'</td></tr>';
    }).join('');
    if(cashIls){ hRows += '<tr class="fb-cash"><td class="fb-h-name"><b>מזומן</b><span>'+esc(ib.cashNote||'')+'</span></td><td></td><td class="fb-h-v">'+fmtK(cashIls)+'</td><td></td><td></td></tr>'; }
    html += fbTile('fb-span7', 'אחזקות ני״ע · <span class="fb-money" dir="ltr">₪'+Math.round(secV).toLocaleString('en-US')+'</span>',
        '<div class="fb-table-wrap"><table class="fb-table"><thead><tr><th>נייר</th><th>משקל</th><th>שווי</th><th>מאז קנייה</th><th>יומי</th></tr></thead><tbody>'+hRows+'</tbody></table></div>'
      + fbDetails([['מחירים בחו״ל נכון ל', ib.pricesAsOf], ['מחירים בישראל נכון ל', bank.pricesAsOf], ['שער דולר', fx ? (fx+' (מ-'+(ib.fxAsOf||'')+')') : ''], ['כמויות סונכרנו ב', ib.allocAsOf || bank.unitsAsOf], ['מוחזק ב', 'חשבון ני״ע — אוצר החייל']]));

    var fMax = funds.reduce(function(a,x){ return Math.max(a, x.o.value||0); }, 0) || 1;
    var fRows = funds.map(function(x){
      var r = x.ret || {};
      return '<div class="fb-fund"><div class="fb-fund-top"><span><i style="background:'+x.color+'"></i>'+esc(x.name)+'</span>'+fmtK(x.o.value||0)+'</div>'
        + '<div class="fb-bar"><i style="width:'+((x.o.value||0)/fMax*100).toFixed(1)+'%;background:'+x.color+'"></i></div>'
        + '<div class="fb-fund-meta"><span>שנה '+pctHTML(r.y1,1)+'</span><span>3 שנים '+pctHTML(r.y3,1)+'</span><span class="fb-term">'+x.term+'</span></div>'
        + fbDetails([['פוליסה', x.o.policy], ['נפתחה', x.o.opened], ['דמי ניהול', x.o.managementFee], ['מסלול', x.o.track || r.track], ['נתוני תשואה', (r.dataAsOf||'') + (r.source?' · '+r.source:'')]])
        + '</div>';
    }).join('');
    html += fbTile('fb-span5', 'קופות וחסכון', fRows);

    // ===== Row 4: real estate, insurance, loan
    if(re){
      var lo = re.currentEstLow||0, hi = re.currentEstHigh||0, mort = re.mortgage||0;
      var scale = Math.max(hi, reMid) || 1;
      html += fbTile('fb-span8', 'נדל״ן · '+esc((re.address||'').split(',').slice(0,2).join(',').replace(/\s*\(.*$/,'')),
          '<div class="fb-re-top"><div><div class="fb-kpi-sub">הון עצמי משוער</div><div class="fb-mid">'+fmtK(reEquity)+'</div></div>'
        + '<div><div class="fb-kpi-sub">שווי היום</div><div class="fb-mid fb-dim"><span dir="ltr">'+fmtK(lo)+' – '+fmtK(hi)+'</span></div></div>'
        + '<div><div class="fb-kpi-sub">אחרי פינוי-בינוי</div><div class="fb-mid fb-dim"><span dir="ltr">'+fmtK(re.estLow||0)+' – '+fmtK(re.estHigh||0)+'</span></div></div></div>'
        + '<div class="fb-re-bar"><i class="m" style="width:'+(mort/scale*100).toFixed(1)+'%"></i><i class="e" style="width:'+(Math.max(0,reMid-mort)/scale*100).toFixed(1)+'%"></i></div>'
        + '<div class="fb-split-legend fb-inline"><div><span><i style="background:#5b5e94"></i>משכנתא</span>'+fmtK(mort)+'</div><div><span><i style="background:'+FB.teal+'"></i>הון עצמי</span>'+fmtK(reEquity)+'</div><div><span><i style="background:'+FB.yellow+'"></i>הושקע עד היום</span>'+fmtK(reSpent)+'</div></div>'
        + fbDetails([['מפרט', re.spec], ['נרכשה', (re.purchaseDate||'')+' · ₪'+(re.purchasePrice||0).toLocaleString('en-US')], ['משכנתא נכון ל', re.mortgageAsOf], ['שכ״ד / משכנתא לחודש', '₪'+(re.monthlyRent||0).toLocaleString('en-US')+' / ₪'+(re.monthlyMortgage||0).toLocaleString('en-US')], ['תזרים מצטבר', reMonths+' חודשים · ₪'+(reMonths*Math.abs(re.monthlyNet||0)).toLocaleString('en-US')], ['הוצאות חד-פעמיות', '₪'+(reSpent - reMonths*Math.abs(re.monthlyNet||0)).toLocaleString('en-US')], ['הערכת שווי נכון ל', re.currentEstAsOf], ['הערת הסוכן', re.currentEstNote], ['הערכה אחרי פינוי-בינוי', re.estNote]]));
    }
    if(f.loan){
      html += fbTile('fb-span4 fb-kpi', 'הלוואות',
          '<div class="fb-kpi-n fb-big2">'+fmtK(loanV)+'</div><div class="fb-kpi-sub">'+esc(f.loan.lender||'')+'</div><div class="fb-kpi-sub">'+esc(f.loan.terms||'')+'</div>');
    }
    html += spendingHTML(f);
    var ins = f.insurances;
    if(ins){
      var dom = {}, order = [];
      (ins.policies||[]).forEach(function(p){
        var d = (p.domain||'').split(' — ')[0];
        if(!(d in dom)){ dom[d]=0; order.push(d); }
        dom[d] += p.monthlyEquivalent||0;
      });
      var dcol = [FB.cyan, FB.magenta, FB.yellow, FB.teal, FB.orange];
      var segs = order.map(function(d,i){ return {label:d, v:dom[d], color:dcol[i%dcol.length]}; });
      var polRows = (ins.policies||[]).slice().sort(function(a,b){ return (b.monthlyEquivalent||0)-(a.monthlyEquivalent||0); }).map(function(p){
        var d = (p.domain||'').split(' — ')[0], col = dcol[order.indexOf(d)%dcol.length];
        return '<tr><td class="fb-h-name"><b style="font-family:Rubik,sans-serif">'+esc(p.title||'')+'</b><span>'+esc(String(p.company||'').replace(' חברה לביטוח',''))+' · <bdi dir="ltr">'+esc(p.period||'')+'</bdi></span></td>'
          + '<td><span class="fb-term" style="color:'+col+'">'+esc(d)+'</span></td><td class="fb-h-v"><span class="fb-money" dir="ltr">₪'+(Math.round((p.monthlyEquivalent||0)*10)/10)+'</span></td></tr>';
      }).join('');
      html += fbTile('fb-span12', 'ביטוחים',
          '<div class="fb-ins-grid"><div>'+fbDonut(segs, '<span dir="ltr">₪'+Math.round(ins.totalMonthly||0)+'</span>', 'לחודש')
        + '<div class="fb-split-legend">'+segs.map(function(s){ return '<div><span><i style="background:'+s.color+'"></i>'+esc(s.label)+'</span><span dir="ltr">₪'+Math.round(s.v)+'</span></div>'; }).join('')+'</div></div>'
        + '<div class="fb-table-wrap"><table class="fb-table"><thead><tr><th>פוליסה</th><th>ענף</th><th>לחודש</th></tr></thead><tbody>'+polRows+'</tbody></table>'
        + fbDetails((ins.policies||[]).map(function(p){ return [p.title||'', 'פוליסה '+(p.policyNumber||'')]; }).concat([['מקור', ins.source]]), 'מספרי פוליסות') + '</div></div>');
    }
    html += '</div>'; // fb-grid

    // ===== Bottom: the reasoning behind the investments
    if(pl){
      html += '<div class="fb-logic"><h2>ההיגיון בהשקעות</h2>';
      if(pl.theme){ html += '<p class="fb-theme">'+esc(pl.theme)+'</p>'; }
      html += '<div class="fb-grid">';
      if(pl.medium){
        var md = pl.medium;
        var curVal = function(key){
          var p = key.split(':');
          if(p[0]==='bank'){ var x = (bank.securitiesBreakdown||[])[parseInt(p[1],10)]; return x?x.value:0; }
          if(p[0]==='ibkr'){ var h = (ib.holdings||[]).find(function(y){return y.ticker===p[1];}); return h?(h.valueIls||0):0; }
          return 0;
        };
        var base = securitiesIls(f) || 1, tMax = 0;
        (md.targets||[]).forEach(function(t){ tMax = Math.max(tMax, t.target, curVal(t.key)/base*100); });
        tMax = Math.ceil((tMax+2)/5)*5;
        var tRows = (md.targets||[]).map(function(t){
          var cur = curVal(t.key)/base*100;
          var color = FB_TICKER[t.key.split(':')[1]] || FB.blue;
          return '<div class="fb-target"><span class="fb-target-l">'+esc(t.label)+(t.buy?'':' <em>ללא קניות</em>')+'</span>'
            + '<div class="fb-target-track"><i style="width:'+(cur/tMax*100).toFixed(1)+'%;background:'+color+'"></i><b style="right:'+(t.target/tMax*100).toFixed(1)+'%"></b></div>'
            + '<span class="fb-target-n" dir="ltr">'+cur.toFixed(0)+'% → '+t.target+'%</span></div>';
        }).join('');
        html += fbTile('fb-span7', 'טווח בינוני · מצב מול יעד',
            '<div class="fb-title-note fb-block">'+fmtK(md.monthly)+' בחודש · '+esc(md.period||'')+' · הקו הלבן = היעד</div>' + tRows
          + '<div class="fb-rule">'+esc(md.rule||'')+'</div>');
      }
      var side = '';
      if(pl.short){
        side += '<div class="fb-title-note fb-block">'+fmtK(pl.short.monthly)+' בחודש · '+esc(pl.short.status||'')+'</div>';
        var scol = [FB.cyan, FB.teal, FB.yellow, FB.magenta];
        side += fbSplitBar((pl.short.allocations||[]).map(function(a,i){ return {label:a.label+' · '+a.pct+'%', v:a.monthly, color:scol[i%scol.length]}; }));
        side += '<div class="fb-rule">'+esc(pl.short.rule||'')+'</div>';
      }
      side += '<div class="fb-rule"><b>טווח ארוך:</b> פנסיה, קרן השתלמות וקופות הגמל — 100% במסלולים עוקבי <span dir="ltr" style="white-space:nowrap">S&amp;P 500</span></div>';
      html += fbTile('fb-span5', 'טווח קצר · אג״ח', side);
      html += '</div>';
      if(pl.asOf){ html += '<div class="fb-asof fb-block">התוכנית עודכנה '+esc(pl.asOf)+'</div>'; }
      html += '</div>';
    }
    html += '</div>'; // .fb
    return html;
  }

  /* ---------- DEBTS PAGE ---------- */
  function debtItemHTML(d){
    var ce = ' contenteditable="plaintext-only" dir="rtl" spellcheck="false" data-debt="'+d.id+'"';
    return '<div class="debt-item">'
      + '<button type="button" class="del-t-btn debt-del" data-action="deldebt" data-debt="'+d.id+'" title="סגור / מחק">✕</button>'
      + '<span class="who inline-edit"'+ce+' data-inline="debtperson" data-ph="שם">'+esc(d.person)+'</span>'
      + '<span class="item inline-edit"'+ce+' data-inline="debtitem" data-ph="מה/כמה (למשל 500 ₪)">'+esc(d.item)+'</span>'
      + '<span class="note inline-edit inline-note'+(d.note?'':' is-empty')+'"'+ce+' data-inline="debtnote" data-ph="הערה…">'+esc(d.note||'')+'</span>'
      + '</div>';
  }

  function debtsPageHTML(state){
    var owes = state.debts.filter(function(d){return d.direction==='owes';});
    var owed = state.debts.filter(function(d){return d.direction==='owed';});
    var html = backLink();
    html += '<div class="page-head"><h1>חובות והלוואות</h1><div class="sub help">חובות לא רשמיים בין שחר לאנשים פרטיים בלבד — הלוואות בנקאיות מתועדות תחת פיננסים · לחיצה על שם, סכום/פריט או הערה עורכת אותם במקום (Enter לשמירה, Esc לביטול) · ✕ סוגר/מוחק חוב שהוסדר</div></div>';
    html += '<div class="panel">';
    html += '<div class="add-task-panel"><div class="add-task-row debt-add-row">'
          + '<select name="debtdir"><option value="owes">שחר חייב ל…</option><option value="owed">חייב/ת לשחר</option></select>'
          + '<input type="text" name="debtperson" placeholder="שם" />'
          + '<input type="text" name="debtitem" placeholder="מה/כמה (למשל 500 ₪ או ספר)" />'
          + '<input type="text" name="debtnote" placeholder="הערה (לא חובה)" />'
          + '<button type="button" data-action="adddebt">+ הוסף</button>'
          + '</div></div>';
    html += '<div class="debt-group"><h3>שחר חייב ל:</h3>';
    if(owes.length===0){ html += '<div class="debt-empty">אין כרגע</div>'; }
    owes.forEach(function(d){
      html += debtItemHTML(d);
    });
    html += '</div>';
    html += '<div class="debt-group"><h3>חייבים לשחר</h3>';
    if(owed.length===0){ html += '<div class="debt-empty">אין כרגע</div>'; }
    owed.forEach(function(d){
      html += debtItemHTML(d);
    });
    html += '</div></div>';
    return html;
  }

  /* ---------- LEISURE PAGE ----------
     notePlaceholder is set only for the books section: Shahar wants every
     book to carry its author's name, but doesn't always know it himself —
     so the field is optional to type into. Whenever it's left blank on add
     or edit, Claude looks up the author automatically (via the page's own
     "ask Claude" capability) and fills it in a moment later — no blocking,
     no required field. While that's in flight the item shows a "מחפש
     מחבר/ת…" placeholder; if Claude can't identify it confidently, it's
     flagged so Shahar can fill it in by hand. Movies/travel have no note
     field at all. */
  function leisureListHTML(sectionKey, title, addPlaceholder, notePlaceholder, items, emptyMsg, autoFillNote, hasTamarMarker){
    var html = '<div class="panel leisure-section-group" data-section="'+sectionKey+'">'
              + '<div class="panel-head">'
              +   '<div class="panel-head-left"><span class="leisure-sec-drag" aria-hidden="true">⠿</span><h2>'+esc(title)+'</h2></div>'
              +   '<span class="badge">'+items.length+'</span>'
              + '</div>';
    html += '<div class="add-task-panel"><div class="add-task-row">'
          + '<input type="text" name="txt" placeholder="'+esc(addPlaceholder)+'" />'
          + (notePlaceholder ? '<input type="text" name="note" placeholder="'+esc(notePlaceholder)+'" />' : '')
          + '<button data-action="addleisure" data-section="'+sectionKey+'" data-hasnote="'+(notePlaceholder?'1':'0')+'" data-autofill="'+(autoFillNote?'1':'0')+'">+ הוסף</button>'
          + '</div></div>';
    html += '<div class="panel-body">';
    if(items.length===0){
      html += '<div class="hc-empty" style="padding:14px 20px;">'+esc(emptyMsg)+'</div>';
    } else {
      html += '<ul class="tasks'+(sectionKey==='cooking'?' grid-list':'')+'" id="leisure-list-'+sectionKey+'">';
      items.forEach(function(it){
        var noteHTML = '';
        if(notePlaceholder){
          var ph = notePlaceholder, extraCls = '';
          if(!it.note && it.authorPending){ ph = 'מחפש מחבר/ת…'; extraCls = ' pending'; }
          else if(!it.note && it.authorUnknown){ ph = 'מחבר/ת לא זוהתה — לחצו כאן כדי להוסיף'; extraCls = ' warn'; }
          var showAlways = !!it.note || it.authorPending || it.authorUnknown;
          noteHTML = '<span class="leisure-note inline-edit inline-note'+extraCls+(showAlways?'':' is-empty')+'" contenteditable="plaintext-only" dir="rtl" spellcheck="false"'
                   + ' data-inline="leisurenote" data-section="'+sectionKey+'" data-item="'+it.id+'" data-autofill="'+(autoFillNote?'1':'0')+'" data-ph="'+esc(ph)+'">'+esc(it.note||'')+'</span>';
        }
        var tamarBtnHTML = hasTamarMarker
          ? '<button class="tamar-btn '+(it.tamarLikes?'on':'')+'" data-action="toggletamar" data-section="'+sectionKey+'" data-item="'+it.id+'" title="גם תמר אוהבת את זה">'+(it.tamarLikes?'●':'○')+'</button>'
          : '';
        html += '<li data-task="'+it.id+'">'
              + '<span class="task-drag-handle" aria-hidden="true">⠿</span>'
              + '<span class="leisure-item-main" data-mainwrap="'+it.id+'">'
              +   '<span class="txt inline-edit" contenteditable="plaintext-only" dir="rtl" spellcheck="false" data-inline="leisuretext" data-section="'+sectionKey+'" data-item="'+it.id+'" data-ph="טקסט">'+esc(it.text)+'</span>'
              +   noteHTML
              + '</span>'
              + tamarBtnHTML
              + '<button class="del-t-btn" data-action="delleisure" data-section="'+sectionKey+'" data-item="'+it.id+'" title="מחק">✕</button>'
              + '</li>';
      });
      html += '</ul>';
    }
    html += '</div></div>';
    return html;
  }

  var LEISURE_SECTIONS = ['books','movies','travel','learning','cooking'];

  function getLeisureSectionOrder(state){
    var stored = state.leisureSectionOrder;
    if(!stored || !stored.length) return LEISURE_SECTIONS.slice();
    var order = stored.filter(function(k){ return LEISURE_SECTIONS.indexOf(k) !== -1; });
    LEISURE_SECTIONS.forEach(function(k){ if(order.indexOf(k)===-1) order.push(k); });
    return order;
  }

  function leisurePageHTML(state){
    var lz = state.leisure || {books:[],movies:[],travel:[],learning:[],cooking:[]};
    var html = backLink();
    html += '<div class="page-head"><h1>פנאי</h1><div class="sub help">ספרים לקריאה, סרטים שמעניינים, רעיונות לטיולים ונושאים ללמידה · לכל ספר גם שם מחבר/ת — אם לא ידוע, קלוד ישלים אותו אוטומטית · לכל נושא למידה יש מקום להערות חופשיות · לחיצה על שם פריט או על ההערה שמתחתיו עורכת אותם במקום (Enter לשמירה, Esc לביטול) · ✕ מחיקה · גררו את הידית (⠿) בתוך רשימה כדי לשנות סדר פריטים, ואת הידית שליד כותרת הקטגוריה כדי לשנות את סדר הקטגוריות עצמן · הוספה מתוך כל רשימה למטה · בבישול, עיגול סגול מלא (●) ליד מתכון מסמן שגם תמר אוהבת אותו — אפשר ללחוץ עליו כדי לסמן/לבטל</div></div>';
    var sectionDefs = {
      books: leisureListHTML('books', 'ספרים לקריאה', 'ספר חדש…', 'שם המחבר/ת (אם לא ידוע — השאירו ריק)', lz.books||[], 'אין ספרים ברשימה כרגע — הוסיפו למעלה.', true),
      movies: leisureListHTML('movies', 'סרטים שמעניינים', 'סרט חדש…', null, lz.movies||[], 'אין סרטים ברשימה כרגע — הוסיפו למעלה.', false),
      travel: leisureListHTML('travel', 'רעיונות לטיולים', 'רעיון טיול חדש…', null, lz.travel||[], 'אין רעיונות טיול ברשימה כרגע — הוסיפו למעלה.', false),
      learning: leisureListHTML('learning', 'נושאים ללמידה', 'נושא חדש…', 'הערות (לא חובה)', lz.learning||[], 'אין נושאים ברשימה כרגע — הוסיפו למעלה.', false),
      cooking: leisureListHTML('cooking', 'בישול', 'מתכון חדש…', 'הערה (לא חובה)', lz.cooking||[], 'אין מתכונים ברשימה כרגע — הוסיפו למעלה.', false, true)
    };
    html += '<div id="leisure-sections">';
    getLeisureSectionOrder(state).forEach(function(key){ html += sectionDefs[key]; });
    html += '</div>';
    return html;
  }

  /* Asks Claude (via the page's own "sample" capability) to identify a
     book's author when Shahar leaves the author field blank on add/edit.
     Runs on its own, independent of any particular open tab — updates
     STATE and publishes a new version once it has an answer (or gives
     up). Re-checks the item by id (and that it's still "pending") both
     before and after the async call, so a manual edit or delete that
     happens while this is in flight is never clobbered. */
  function lookupBookAuthor(section, id){
    function getItem(){
      return ((STATE.leisure && STATE.leisure[section]) || []).find(function(x){return x.id===id;});
    }
    (async function(){
      var sample = null;
      try{ sample = await claude.use('sample'); }catch(e){}
      var it = getItem();
      if(!it || !it.authorPending) return;
      if(!sample){
        it.authorPending = false;
        it.authorUnknown = true;
        scheduleSave();
        return;
      }
      try{
        var res = await sample('מהו שם המחבר/ת של הספר "'+it.text+'"? השב אך ורק בשם המחבר/ת המלא (בעברית אם יש לו שם מוכר בעברית), בלי מילים נוספות ובלי סימני פיסוק מיותרים. אם אינך מזהה את הספר הזה בביטחון סביר, השב בדיוק במילה הזו: לא ידוע');
        var ans = ((res && res.text) || '').trim();
        it = getItem();
        if(!it || !it.authorPending) return;
        if(ans && ans !== 'לא ידוע' && ans.length <= 60 && ans.indexOf('\n')===-1){
          it.note = ans;
          it.authorPending = false;
          delete it.authorUnknown;
        } else {
          it.authorPending = false;
          it.authorUnknown = true;
        }
      }catch(e){
        it = getItem();
        if(it && it.authorPending){ it.authorPending = false; it.authorUnknown = true; }
      }
      scheduleSave();
    })();
  }

  /* ---------- SPORTS PAGE ---------- */
  function sportsPageHTML(state){
    var s = state.sports;
    var html = backLink();
    html += '<div class="page-head"><h1>ספורט ואימונים</h1><div class="sub help">סוגי האימונים שלך · לחיצה על שם סוג אימון עורכת אותו במקום · ✕ ליד שם האימון מוחק את כל סוג האימון (הרשומות שלו ביומן נשארות) · בתחתית הרשימה ניתן להוסיף סוג אימון חדש · לכל תרגיל המשקל האחרון שנרשם וסרטון הדרכה · לחיצה על שם התרגיל או על הסטים/חזרות עורכת אותם במקום · ✕ מחיקת תרגיל · גררו את הידית (⠿) כדי לשנות את סדר התרגילים · בתחתית כל יום ניתן להוסיף תרגיל חדש · למטה: יומן אימונים (מזין את הגרף — ניתן להוסיף/לערוך תאריך/למחוק רשומה אם יש טעות) ומעקב ריצות</div></div>';
    html += workoutSummaryHTML(state);
    html += '<div class="panel"><div class="panel-head"><h2>סוגי אימונים</h2><span class="badge">'+s.days.length+'</span></div><div class="panel-body">';
    if(s.days.length===0){ html += '<div class="hc-empty" style="padding:14px 20px;">אין סוגי אימונים — הוסיפו למטה.</div>'; }
    s.days.forEach(function(d){
      html += '<div class="day-card"><div class="day-head"><div><div class="day-title-row"><span class="day-dot" style="background:'+dayColor(d.id, s)+';"></span>'
            + '<h3 class="inline-edit" contenteditable="plaintext-only" dir="rtl" spellcheck="false" data-inline="dayname" data-day="'+d.id+'" data-ph="שם האימון">'+esc(d.name)+'</h3>'
            + '<button type="button" class="del-ex-btn del-day-btn" data-action="delday" data-day="'+d.id+'" title="מחק את סוג האימון">✕</button></div><span class="last-done">'+(d.lastDone?'בוצע לאחרונה: '+d.lastDone:'טרם נרשם')+'</span></div>';
      html += '<button class="log-btn" data-action="logday" data-day="'+d.id+'">✓ סיימתי היום את האימון</button></div>';
      html += '<table class="ex"><tbody id="ex-body-'+d.id+'">';
      d.exercises.forEach(function(ex, exi){
        var key = d.id+'|'+exi;
        html += '<tr data-exi="'+exi+'">';
        html += '<td class="exmove"><button type="button" class="ex-drag-handle" title="גרור לשינוי סדר">⠿</button></td>';
        html += '<td class="exname" data-excell="'+key+'">'
              + '<span class="inline-edit" contenteditable="plaintext-only" dir="rtl" spellcheck="false" data-inline="exname" data-day="'+d.id+'" data-ex="'+exi+'" data-ph="שם התרגיל">'+esc(ex.name)+'</span>'
              + '<span class="sr inline-edit inline-note'+(ex.setsReps?'':' is-empty')+'" contenteditable="plaintext-only" dir="rtl" spellcheck="false" data-inline="exsr" data-day="'+d.id+'" data-ex="'+exi+'" data-ph="סטים/חזרות">'+esc(ex.setsReps||'')+'</span>'
              + '<button type="button" class="del-ex-btn" data-action="delex" data-day="'+d.id+'" data-ex="'+exi+'" title="מחק תרגיל">✕</button></td>';
        html += '<td class="exw" data-wcell="'+key+'">';
        if(ex.noWeight){
          html += '<span style="color:var(--text-muted);font-family:\'Rubik\',sans-serif;">ללא משקל</span>';
        } else if(ex.lastWeight!=null){
          html += ex.lastWeight+' ק״ג<span class="lastdate">'+(ex.lastDate?ex.lastDate:'')+'</span>';
        } else {
          html += '<span style="color:var(--text-muted);font-family:\'Rubik\',sans-serif;">לא נרשם</span>';
        }
        if(!ex.noWeight){
          html += ' <button class="edit-w-btn" data-action="editw" data-day="'+d.id+'" data-ex="'+exi+'">עדכון</button>';
        }
        html += '</td>';
        html += '<td class="exyt"><a class="yt-link" href="'+ex.yt+'" target="_blank" rel="noopener">▶</a></td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
      html += '<div class="add-ex-panel"><div class="add-ex-row">'
            + '<input type="text" class="add-ex-name-input" placeholder="שם תרגיל חדש…" />'
            + '<input type="text" class="add-ex-sr-input" placeholder="סטים/חזרות (למשל 4x10)" />'
            + '<button type="button" data-action="addex" data-day="'+d.id+'">+ הוסף תרגיל</button>'
            + '</div></div>';
      html += '</div>';
    });
    html += '</div>';
    html += '<div class="add-ex-panel add-day-panel"><div class="add-ex-row">'
          + '<input type="text" class="add-ex-name-input add-day-name-input" placeholder="סוג אימון חדש (למשל: אימון בים)…" />'
          + '<button type="button" data-action="addday">+ הוסף סוג אימון</button>'
          + '</div></div>';
    html += '</div>';
    html += workoutLogPanelHTML(state);
    html += runsPanelHTML(state);
    return html;
  }

  /* ---------- SPORTS: WORKOUT SUMMARY + RUNS ---------- */
  var DAY_COLORS = {upperA:'var(--cat-blue)', lowerB:'var(--cat-olive)', upperC:'var(--cat-violet)'};
  var DAY_PALETTE = ['var(--cat-blue)','var(--cat-olive)','var(--cat-violet)','var(--cat-teal)','var(--critical)','var(--warn)'];
  // Fixed colors for the original 3 days; any day added later gets a palette color by its position.
  function dayColor(dayId, sports){
    if(DAY_COLORS[dayId]) return DAY_COLORS[dayId];
    var days = ((sports || STATE.sports || {}).days) || [];
    var idx = days.findIndex(function(d){ return d.id===dayId; });
    return idx === -1 ? 'var(--accent)' : DAY_PALETTE[idx % DAY_PALETTE.length];
  }
  var RUN_COLOR = 'var(--cat-orange)';

  function dayLetter(name){
    var m = String(name||'').trim().match(/([A-Za-z])$/);
    return m ? m[1].toUpperCase() : String(name||'?').charAt(0).toUpperCase();
  }

  // Builds one entry per day for the last `numDays` days (oldest first, today last),
  // with the workout(s)/run(s) logged on that specific calendar day attached — this
  // is what lets the summary show, per day, whether a workout happened and which one.
  function buildDailyMarks(state, numDays){
    var s = state.sports;
    var out = [];
    var today = new Date(); today.setHours(0,0,0,0);
    for(var i=numDays-1;i>=0;i--){
      var d = new Date(today.getTime() - i*24*3600*1000);
      out.push({
        key: d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate(),
        label: d.getDate()+'.'+(d.getMonth()+1),
        isToday: i===0,
        workouts: [],
        runs: []
      });
    }
    var byKey = {};
    out.forEach(function(o){ byKey[o.key] = o; });
    (s.workoutLog||[]).forEach(function(w){
      var dt = parseHeDate(w.date);
      if(!dt) return;
      var key = dt.getFullYear()+'-'+(dt.getMonth()+1)+'-'+dt.getDate();
      if(byKey[key]) byKey[key].workouts.push(w);
    });
    (s.runs||[]).forEach(function(r){
      var dt = parseHeDate(r.date);
      if(!dt) return;
      var key = dt.getFullYear()+'-'+(dt.getMonth()+1)+'-'+dt.getDate();
      if(byKey[key]) byKey[key].runs.push(r);
    });
    return out;
  }

  function workoutGraphSVG(days, opts){
    opts = opts || {};
    var compact = !!opts.compact;
    var n = days.length;
    var W = compact ? 320 : 680;
    var H = compact ? 60 : 130;
    var padX = compact ? 8 : 20;
    var baseY = H - (compact ? 12 : 28);
    var peakY = compact ? 12 : 26;
    var runY = compact ? 30 : 62;
    var stepX = n > 1 ? (W - padX*2) / (n-1) : 0;
    function xFor(i){ return padX + i*stepX; }
    function heightFor(day){
      if(day.workouts.length) return peakY;
      if(day.runs.length) return runY;
      return baseY;
    }
    var pts = days.map(function(d,i){ return xFor(i)+','+heightFor(d); }).join(' ');
    var svg = '<svg viewBox="0 0 '+W+' '+H+'" class="workout-graph-svg" preserveAspectRatio="xMidYMid meet">';
    svg += '<line x1="'+padX+'" y1="'+baseY+'" x2="'+(W-padX)+'" y2="'+baseY+'" style="stroke:var(--border);stroke-width:1;" />';
    svg += '<polyline points="'+pts+'" style="fill:none;stroke:var(--accent);stroke-width:'+(compact?1.5:2)+';stroke-linejoin:round;stroke-linecap:round;opacity:.5;" />';
    days.forEach(function(d,i){
      var x = xFor(i);
      if(d.isToday){
        svg += '<line x1="'+x+'" y1="2" x2="'+x+'" y2="'+(H-2)+'" style="stroke:var(--accent);stroke-width:1;stroke-dasharray:2,3;opacity:.35;" />';
      }
      if(d.runs.length && !d.workouts.length){
        svg += '<circle cx="'+x+'" cy="'+runY+'" r="'+(compact?4:6)+'" style="fill:'+RUN_COLOR+';"><title>ריצה · '+esc(d.label)+'</title></circle>';
      } else if(d.runs.length && d.workouts.length){
        svg += '<circle cx="'+x+'" cy="'+(peakY - (compact?8:16))+'" r="'+(compact?3:5)+'" style="fill:'+RUN_COLOR+';"><title>ריצה · '+esc(d.label)+'</title></circle>';
      }
      if(d.workouts.length){
        var w = d.workouts[d.workouts.length-1];
        var color = dayColor(w.dayId);
        var letter = dayLetter(w.dayName);
        var r = compact ? 7 : 12;
        svg += '<circle cx="'+x+'" cy="'+peakY+'" r="'+r+'" style="fill:'+color+';"><title>'+esc(w.dayName)+' · '+esc(d.label)+'</title></circle>';
        // Show the day letter (A/B/C) inside the peak dot even in the compact
        // (home-page mini) graph — Shahar said the mini version was "completely
        // empty, no text" and asked to see which workout it was, not just a dot.
        var letterFontSize = compact ? 8.5 : 12;
        var letterDy = compact ? 3 : 4.5;
        svg += '<text x="'+x+'" y="'+(peakY+letterDy)+'" text-anchor="middle" font-family="Rubik,sans-serif" font-size="'+letterFontSize+'" font-weight="700" style="fill:#fff;">'+esc(letter)+'</text>';
      } else if(!d.runs.length){
        svg += '<circle cx="'+x+'" cy="'+baseY+'" r="'+(compact?2:3)+'" style="fill:var(--border);" />';
      }
    });
    svg += '</svg>';
    return svg;
  }

  function workoutGraphLabelsHTML(days){
    return '<div class="workout-graph-labels">' + days.map(function(d){
      return '<span class="wgl'+(d.isToday?' today':'')+'">'+esc(d.label)+'</span>';
    }).join('') + '</div>';
  }

  function workoutGraphLegendHTML(state){
    var items = state.sports.days.map(function(d){ return {label:d.name, color: dayColor(d.id, state.sports)}; });
    items.push({label:'ריצה', color: RUN_COLOR});
    return '<div class="workout-graph-legend">' + items.map(function(it){
      return '<span class="wgl-item"><span class="dot" style="background:'+it.color+';"></span>'+esc(it.label)+'</span>';
    }).join('') + '</div>';
  }

  function homeSportsMiniHTML(state){
    var days = buildDailyMarks(state, 14);
    var activeDays = days.filter(function(d){ return d.workouts.length || d.runs.length; }).length;
    if(activeDays === 0){
      return '<div class="hc-empty">אין אימונים רשומים ב-14 הימים האחרונים</div>';
    }
    var html = '<div class="workout-graph-wrap compact">' + workoutGraphSVG(days, {compact:true});
    html += workoutGraphLabelsHTML(days).replace('class="workout-graph-labels"', 'class="workout-graph-labels compact-labels"');
    html += '</div>';
    return html;
  }

  function workoutSummaryHTML(state){
    var days = buildDailyMarks(state, 14);
    var activeDays = days.filter(function(d){ return d.workouts.length || d.runs.length; }).length;
    var html = '<div class="panel"><div class="panel-head"><h2>סיכום אימונים — 14 הימים האחרונים</h2><span class="badge">'+activeDays+' ימי פעילות</span></div>';
    html += '<div class="workout-graph-wrap">';
    if(activeDays === 0){
      html += '<div class="hc-empty">עדיין לא נרשמו אימונים ב-14 הימים האחרונים — לחץ "סיימתי היום את האימון" בכל יום אימון, או הוסף ריצה למטה.</div>';
    } else {
      html += workoutGraphSVG(days, {compact:false});
      html += workoutGraphLabelsHTML(days);
      html += workoutGraphLegendHTML(state);
    }
    html += '</div></div>';
    return html;
  }

  function fmtPace(minutes, km){
    if(!km) return '—';
    var paceMin = minutes / km;
    var mm = Math.floor(paceMin);
    var ss = Math.round((paceMin - mm) * 60);
    if(ss === 60){ mm += 1; ss = 0; }
    return mm + ':' + (ss<10?'0':'') + ss + ' דק׳/ק״מ';
  }

  function todayIsoDate(){
    var now = new Date();
    var mm = (now.getMonth()+1); var dd = now.getDate();
    return now.getFullYear()+'-'+(mm<10?'0':'')+mm+'-'+(dd<10?'0':'')+dd;
  }

  function workoutLogPanelHTML(state){
    var log = (state.sports.workoutLog||[]).slice().sort(function(a,b){
      var da = parseHeDate(a.date), db = parseHeDate(b.date);
      return (db?db.getTime():0) - (da?da.getTime():0);
    });
    var html = '<div class="panel"><div class="panel-head"><h2>יומן אימונים</h2><span class="badge">'+log.length+' רשומות</span></div>';
    html += '<div class="runs-form"><div class="runs-form-row">'
          + '<select name="wlday">'
          + state.sports.days.map(function(d){return '<option value="'+d.id+'">'+esc(d.name)+'</option>';}).join('')
          + '</select>'
          + '<input type="date" name="wldate" value="'+todayIsoDate()+'" />'
          + '<button type="button" data-action="addwl">+ הוסף רשומה</button>'
          + '</div></div>';
    html += '<div class="panel-body">';
    if(log.length === 0){
      html += '<div class="hc-empty" style="padding:14px 18px;">אין רשומות ביומן האימונים. ניתן להוסיף למעלה, או ללחוץ "סיימתי היום את האימון" בכרטיס יום אימון.</div>';
    } else {
      log.forEach(function(w){
        html += '<div class="run-row">';
        html += '<div class="run-row-head"><span class="run-date">'+esc(w.dayName)+'</span>'
              + '<span class="run-meta" data-wldatecell="'+w.id+'">'+esc(w.date)+'</span>'
              + '<button type="button" class="edit-w-btn" data-action="editwl" data-wl="'+w.id+'" title="ערוך תאריך">✎</button>'
              + '<button type="button" class="run-del" data-action="delwl" data-wl="'+w.id+'" title="מחק רשומה">✕</button></div>';
        html += '</div>';
      });
    }
    html += '</div></div>';
    return html;
  }

  function runsPanelHTML(state){
    var runs = (state.sports.runs||[]).slice().sort(function(a,b){
      var da = parseHeDate(a.date), db = parseHeDate(b.date);
      return (db?db.getTime():0) - (da?da.getTime():0);
    });
    var maxKm = Math.max.apply(null, runs.map(function(r){return r.km;}).concat([1]));
    var html = '<div class="panel"><div class="panel-head"><h2>ריצות</h2><span class="badge">'+runs.length+' ריצות</span></div>';
    html += '<div class="runs-form"><div class="runs-form-row">'
          + '<input type="date" name="rundate" value="'+todayIsoDate()+'" />'
          + '<input type="number" step="0.1" min="0" name="runkm" placeholder="ק״מ" />'
          + '<input type="number" step="1" min="0" name="runmin" placeholder="דקות" />'
          + '<button type="button" data-action="addrun">+ הוסף ריצה</button>'
          + '</div></div>';
    html += '<div class="panel-body">';
    if(runs.length === 0){
      html += '<div class="hc-empty" style="padding:14px 18px;">עדיין לא נרשמו ריצות. הוסף ריצה למעלה — תאריך, מרחק בק״מ וזמן בדקות.</div>';
    } else {
      runs.forEach(function(r){
        var pct = maxKm ? (r.km / maxKm * 100) : 0;
        html += '<div class="run-row">';
        html += '<div class="run-row-head"><span class="run-date">'+esc(r.date)+'</span><span class="run-meta">'+r.km+' ק״מ · '+r.minutes+' דק׳ · '+fmtPace(r.minutes, r.km)+'</span>'
              + '<button type="button" class="run-del" data-action="delrun" data-run="'+r.id+'" title="מחק ריצה">✕</button></div>';
        html += '<div class="bar-track"><div class="bar-fill" style="width:'+pct+'%;background:'+RUN_COLOR+';"></div></div>';
        html += '</div>';
      });
    }
    html += '</div></div>';
    return html;
  }

  /* ---------- DIET PAGE (תזונה) ----------
     Daily food log, weekly calorie budget, daily protein, weekly weight.
     Synced to Drive (אישי/MEMORY.md), like every other page:
       diet.stats   {kcal, protein, goal, pace}              daily targets and goal weight
       diet.log     [{id, date:'YYYY-MM-DD', text, kcal, protein, src, as?, g?:{k,p}, c?:{k,p}, sum?}]
       diet.foods   [{id, text, kcal, protein}]              one-tap fixed foods
       diet.meals   [{id, cat, text, kcal, protein, note?}]  meal options (incl. the Saturday meal prep)
       diet.weights [{id:'w_<sunday>', date:'<sunday>', kg}]
     The week runs Sunday to Saturday. Calories are budgeted per week (kcal x 7), protein per day.
     AI estimates: Gemini (Interactions API) and Claude (Messages API) are called straight from the
     browser. The keys live in the user's own Drive (אישי/dashboard-ai-keys.json, synced by boot.js)
     and are cached in localStorage 'dietAI'; never in the public repo. */
  var DIET_WEEKDAYS = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
  var DIET_DN = ['א','ב','ג','ד','ה','ו','ש'];
  var DIET_CATS = ['בוקר','צהריים','ערב'];
  var DIET_KEEP_DAYS = 56; // older entries are folded into one summary line per day
  var DIET_AI_NAMES = {gemini:'Gemini', claude:'Claude'};
  var DIET_UI = {sel:null, weekOff:0, draft:'', pending:null, seq:0, timer:null, refocus:false, settings:false, bound:false};

  function dietISO(d){ return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); }
  function dietParse(iso){ var p = String(iso).split('-'); return new Date(+p[0], +p[1]-1, +p[2]); }
  function dietAddDays(iso, n){ var d = dietParse(iso); d.setDate(d.getDate()+n); return dietISO(d); }
  function dietToday(){ return dietISO(new Date()); }
  function dietSunday(iso){ var d = dietParse(iso); d.setDate(d.getDate()-d.getDay()); return dietISO(d); }
  function dietShort(iso){ var d = dietParse(iso); return d.getDate()+'.'+(d.getMonth()+1); }
  function dietNum(n, digits){
    if(n==null || isNaN(n)) return '—';
    return Number(n).toLocaleString('en-US', {maximumFractionDigits: digits==null?1:digits});
  }
  function dietSum(items, key){ return items.reduce(function(a, x){ return a+(+x[key]||0); }, 0); }

  function dietData(state){
    var d = state.diet || {}, st = d.stats || {};
    return {
      stats: {kcal: st.kcal||1800, protein: st.protein||135, goal: st.goal||72, pace: st.pace||0.8},
      log: d.log || [], foods: d.foods || [], meals: d.meals || [],
      weights: (d.weights || []).slice().sort(function(a, b){ return a.date < b.date ? -1 : 1; })
    };
  }
  function dietDay(dd, iso){ return dd.log.filter(function(x){ return x.date === iso; }); }
  function dietWeek(dd, sunday){
    var days = [];
    for(var i=0;i<7;i++){
      var iso = dietAddDays(sunday, i), items = dietDay(dd, iso);
      days.push({iso: iso, items: items, k: dietSum(items, 'kcal'), p: Math.round(dietSum(items, 'protein'))});
    }
    return days;
  }
  // Calories still open for `iso` so the week ends on budget: what's left of kcal x 7 after the
  // days before it, spread evenly over it and the days after it, minus what it already has.
  function dietRoom(dd, days, iso){
    var idx = Math.max(0, days.findIndex(function(d){ return d.iso === iso; }));
    var before = days.slice(0, idx).reduce(function(a, d){ return a+d.k; }, 0);
    var perDay = (dd.stats.kcal*7 - before) / (7-idx);
    return {perDay: perDay, left: perDay - days[idx].k, day: days[idx]};
  }

  /* --- page --- */
  function dietPageHTML(state){
    var dd = dietData(state), today = dietToday();
    var sunday = dietAddDays(dietSunday(today), DIET_UI.weekOff*7), saturday = dietAddDays(sunday, 6);
    if(!DIET_UI.sel || DIET_UI.sel < sunday || DIET_UI.sel > saturday) DIET_UI.sel = DIET_UI.weekOff===0 ? today : sunday;
    var ae = document.activeElement;
    DIET_UI.refocus = !!(ae && ae.id === 'dz-q');
    var days = dietWeek(dd, sunday);
    var html = backLink();
    html += '<div class="page-head"><h1>תזונה</h1><div class="sub help">כותבים מה אכלתם ומחכים רגע: Gemini ו-Claude מעריכים קלוריות וחלבון, ואתם מחליטים אם להוסיף · 📷 צילום מנה · מאכלים קבועים וארוחות נוספים בלחיצה · לחיצה על יום בגרף פותחת אותו, גם כדי להשלים יום קודם · תקציב הקלוריות שבועי (ראשון עד שבת), החלבון יומי · מפתחות ה-AI, היעדים, המאכלים והארוחות נמצאים בהגדרות</div></div>';
    html += dietHeroHTML(dd, days, sunday);
    html += dietLogHTML(dd);
    html += dietMenuHTML(dd);
    html += dietWeightHTML(dd);
    html += dietSettingsHTML(dd);
    return html;
  }

  function dietHeroHTML(dd, days, sunday){
    var today = dietToday(), P = dd.stats.protein, W = dd.stats.kcal*7;
    var inWeek = today >= sunday && today <= days[6].iso;
    var room = dietRoom(dd, days, DIET_UI.sel), fd = room.day;
    var used = days.reduce(function(a, d){ return a+d.k; }, 0);
    var dayLabel = fd.iso===today ? 'היום' : 'ב'+DIET_WEEKDAYS[dietParse(fd.iso).getDay()];
    var html = '<section class="panel dz-panel">';
    html += '<div class="dz-weeknav"><button class="dz-nav" data-dz="week" data-v="-1" aria-label="שבוע קודם">›</button>'
         +  '<span>'+(DIET_UI.weekOff===0?'השבוע':'שבוע')+' · <bdi dir="ltr">'+dietShort(sunday)+'–'+dietShort(days[6].iso)+'</bdi></span>'
         +  '<button class="dz-nav" data-dz="week" data-v="1" aria-label="שבוע הבא"'+(DIET_UI.weekOff>=0?' disabled':'')+'>‹</button></div>';
    html += '<div class="dz-hero">';
    html += '<div class="dz-meter"><span class="l">חלבון '+dayLabel+'</span>'
         +  '<span class="v"><bdi dir="ltr">'+fd.p+' <small>/ '+P+'</small></bdi> <small>ג׳</small></span>'
         +  '<div class="dz-bar"><span style="width:'+Math.min(100, fd.p/P*100)+'%;background:var(--accent)"></span></div>'
         +  '<span class="s">'+(fd.p < P ? 'חסרים <b class="num">'+(P-fd.p)+'</b> ג׳' : '<b class="dz-ok">הגעת ליעד ✓</b>')+'</span></div>';
    var sub;
    if(inWeek || DIET_UI.sel >= today) sub = dayLabel+' אפשר עוד <b class="num'+(room.left<0?' dz-warn':'')+'">'+dietNum(room.left,0)+'</b> · ממוצע '+dietNum(room.perDay,0)+' ליום עד סוף השבוע';
    else sub = used <= W ? 'נשארו '+dietNum(W-used,0)+' מהתקציב' : '<b class="dz-warn">חריגה של '+dietNum(used-W,0)+'</b>';
    html += '<div class="dz-meter"><span class="l">קלוריות השבוע</span>'
         +  '<span class="v"><bdi dir="ltr">'+dietNum(used,0)+' <small>/ '+dietNum(W,0)+'</small></bdi></span>'
         +  '<div class="dz-bar"><span style="width:'+Math.min(100, used/W*100)+'%;background:'+(used>W?'var(--warn)':'var(--ok)')+'"></span></div>'
         +  '<span class="s">'+sub+'</span></div>';
    html += '</div>';
    var max = Math.max(2600, Math.max.apply(null, days.map(function(d){ return d.k; })) + 100);
    html += '<div class="dz-days">' + days.map(function(d, i){
      return '<button class="dz-day'+(d.iso===DIET_UI.sel?' sel':'')+'" data-dz="day" data-v="'+d.iso+'" aria-label="'+DIET_WEEKDAYS[i]+' '+dietShort(d.iso)+': '+d.k+' קלוריות, '+d.p+' ג׳ חלבון">'
        + '<span class="dz-col"><i style="bottom:'+(dd.stats.kcal/max*100)+'%"></i>'
        + (d.k ? '<span class="'+(d.k>dd.stats.kcal?'over':'')+'" style="height:'+(d.k/max*100)+'%"></span>' : '') + '</span>'
        + '<span class="dn">'+DIET_DN[i]+'</span><span class="pr'+(d.p>=P?' hit':'')+(d.iso>today?' fut':'')+'"></span></button>';
    }).join('') + '</div>';
    html += '<div class="dz-legend"><span><em class="k"></em>קלוריות ביום</span><span><em class="line"></em>'+dietNum(dd.stats.kcal,0)+'</span><span><em class="p"></em>הגעתי ל-'+P+' ג׳ חלבון</span></div>';
    html += '</section>';
    return html;
  }

  function dietPills(k, p){
    return '<span class="dz-pill k"><b>'+dietNum(k,0)+'</b></span><span class="dz-pill p"><b>'+Math.round(p||0)+'</b> ג׳</span>';
  }

  function dietLogHTML(dd){
    var iso = DIET_UI.sel, items = dietDay(dd, iso), today = dietToday();
    var title = iso===today ? 'היום' : (iso===dietAddDays(today,-1) ? 'אתמול' : 'יום '+DIET_WEEKDAYS[dietParse(iso).getDay()]);
    var html = '<section class="panel dz-panel">';
    html += '<div class="dz-head"><h2>'+title+' · '+dietShort(iso)+'</h2><span class="dz-sub">'+dietNum(dietSum(items,'kcal'),0)+' קל׳ · '+Math.round(dietSum(items,'protein'))+' ג׳ חלבון</span></div>';
    html += '<div class="dz-add"><input type="text" id="dz-q" dir="rtl" autocomplete="off" enterkeyhint="done" placeholder="מה אכלת? כל דבר: פסטה עם עוף, שווארמה…" aria-label="מה אכלת" value="'+esc(DIET_UI.draft)+'">'
         +  '<label class="dz-btn ghost dz-cam" title="צילום מנה" aria-label="צילום מנה">📷<input type="file" id="dz-photo" accept="image/*" capture="environment"></label></div>';
    if(dd.foods.length){
      html += '<div class="dz-chips">' + dd.foods.map(function(f){
        return '<button class="dz-chip" data-dz="food" data-v="'+esc(f.id)+'">'+esc(f.text)+'</button>';
      }).join('') + '</div>';
    }
    html += '<div id="dz-confirm">'+dietConfirmHTML()+'</div>';
    html += '<ul class="dz-log">';
    if(!items.length) html += '<li class="dz-empty">עוד לא הוזן כלום ליום הזה.</li>';
    items.forEach(function(x){
      html += '<li><span class="t">'+esc(x.text)+(x.as?'<small>'+esc(x.as)+'</small>':'')+'</span>'+dietPills(x.kcal, x.protein)
           +  '<button class="dz-x" data-dz="del" data-v="'+esc(x.id)+'" aria-label="מחק '+esc(x.text)+'">✕</button></li>';
    });
    html += '</ul></section>';
    return html;
  }

  function dietMenuHTML(dd){
    var cats = DIET_CATS.slice();
    dd.meals.forEach(function(m){ if(m.cat && cats.indexOf(m.cat)<0) cats.push(m.cat); });
    var html = '<section class="panel dz-panel"><div class="dz-head"><h2>מה אוכלים</h2><span class="dz-sub">+ מוסיף ליום שנבחר</span></div>';
    cats.forEach(function(cat){
      var ms = dd.meals.filter(function(m){ return (m.cat||'צהריים') === cat; });
      if(!ms.length) return;
      html += '<div class="dz-group"><h3>'+esc(cat)+(cat==='צהריים'?' · מה-meal prep':'')+'</h3>';
      ms.forEach(function(m){
        html += '<div class="dz-meal"><span class="t">'+esc(m.text)+(m.note?'<small>'+esc(m.note)+'</small>':'')+'</span>'+dietPills(m.kcal, m.protein)
             +  '<button class="dz-plus" data-dz="meal" data-v="'+esc(m.id)+'" aria-label="הוסף '+esc(m.text)+'">+</button></div>';
      });
      html += '</div>';
    });
    html += '<div class="dz-sub">Meal prep בשבת: 2–3 מנות צהריים לראשון עד חמישי.</div></section>';
    return html;
  }

  function dietWeightHTML(dd){
    var ws = dd.weights, st = dd.stats, thisSun = dietSunday(dietToday());
    var cur = ws.find(function(w){ return w.date === thisSun; });
    var html = '<section class="panel dz-panel"><div class="dz-head"><h2>משקל שבועי</h2><span class="dz-sub">פעם בשבוע, בראשון בבוקר</span></div>';
    if(ws.length){
      var last = ws[ws.length-1], prev = ws.length>1 ? ws[ws.length-2] : null, ch = prev ? last.kg-prev.kg : null;
      html += dietWeightChart(ws, st.goal, st.pace);
      html += '<div class="dz-wstats">'
           +  '<div><span class="l">אחרון · '+dietShort(last.date)+'</span><span class="v">'+last.kg.toFixed(1)+'</span></div>'
           +  '<div><span class="l">שינוי מהשקילה הקודמת</span><span class="v '+(ch==null?'':(ch<=0?'dz-ok':'dz-warn'))+'">'+(ch==null?'—':(ch>0?'+':'')+ch.toFixed(1))+'</span></div>'
           +  '<div><span class="l">נשאר ליעד</span><span class="v">'+Math.max(0, last.kg-st.goal).toFixed(1)+'</span></div>'
           +  '<div><span class="l">ירידה מההתחלה</span><span class="v">'+(ws[0].kg-last.kg).toFixed(1)+'</span></div></div>';
    }
    html += '<div class="dz-wrow"><input type="number" id="dz-w" step="0.1" inputmode="decimal" placeholder="ק״ג" aria-label="משקל השבוע" value="'+(cur?cur.kg:'')+'">'
         +  '<button class="dz-btn ghost" data-dz="wsave">'+(cur?'עדכן':'שמור')+' את השבוע ('+dietShort(thisSun)+')</button></div>';
    if(ws.length > 1){
      html += '<details class="dz-wlist"><summary>כל השקילות</summary><ul class="dz-mini">' + ws.slice().reverse().map(function(w){
        return '<li><span>'+dietShort(w.date)+'</span><span class="num">'+w.kg.toFixed(1)+'</span><button class="dz-x" data-dz="delw" data-v="'+esc(w.id)+'" aria-label="מחק שקילה">✕</button></li>';
      }).join('') + '</ul></details>';
    }
    html += '</section>';
    return html;
  }

  function dietWeightChart(ws, goal, pace){
    var start = ws[0], W = 320, H = 134, L = 30, R = 12, T = 16, B = 22;
    var idx = function(iso){ return Math.round((dietParse(iso) - dietParse(start.date)) / (7*864e5)); };
    var goalIdx = Math.max(1, Math.ceil((start.kg - goal) / (pace||0.8)));
    var lastIdx = idx(ws[ws.length-1].date);
    var n = Math.max(goalIdx, lastIdx+1, 4);
    var vals = ws.map(function(w){ return w.kg; }).concat([goal]);
    var lo = Math.floor(Math.min.apply(null, vals) - 0.5), hi = Math.ceil(Math.max.apply(null, vals) + 0.5);
    var x = function(i){ return L + i/n*(W-L-R); }, y = function(v){ return T + (hi-v)/(hi-lo)*(H-T-B); };
    var s = '<svg class="dz-wchart" dir="ltr" viewBox="0 0 '+W+' '+H+'" width="100%" role="img" aria-label="משקל שבועי מול הקו ליעד">';
    [goal, start.kg].forEach(function(v){
      s += '<line x1="'+L+'" x2="'+(W-R)+'" y1="'+y(v)+'" y2="'+y(v)+'" class="grid"/><text x="2" y="'+(y(v)+4)+'">'+v+'</text>';
    });
    s += '<line x1="'+x(0)+'" y1="'+y(start.kg)+'" x2="'+x(goalIdx)+'" y2="'+y(goal)+'" class="goal"/>';
    s += '<polyline class="wline" points="'+ws.map(function(w){ return x(idx(w.date))+','+y(w.kg); }).join(' ')+'"/>';
    ws.forEach(function(w, i){
      var last = i === ws.length-1;
      s += '<circle cx="'+x(idx(w.date))+'" cy="'+y(w.kg)+'" r="'+(last?5:3.5)+'" class="pt"/>';
      if(last) s += '<text x="'+x(idx(w.date))+'" y="'+(y(w.kg)-9)+'" text-anchor="middle" class="lbl">'+w.kg.toFixed(1)+'</text>';
    });
    s += '<text x="'+x(0)+'" y="'+(H-4)+'" text-anchor="start">'+dietShort(start.date)+'</text>';
    s += '<text x="'+x(goalIdx)+'" y="'+(H-4)+'" text-anchor="end">יעד '+dietShort(dietAddDays(start.date, goalIdx*7))+'</text>';
    return s + '</svg>';
  }

  function dietSettingsHTML(dd){
    var c = dietAIConf(), st = dd.stats;
    var h = '<details class="panel dz-panel dz-settings" id="dz-settings"'+(DIET_UI.settings?' open':'')+'><summary>הגדרות: יעדים, AI, מאכלים וארוחות</summary><div class="dz-set">';
    h += '<h3>יעדים</h3><div class="dz-form">'
      +  '<label>קלוריות ליום<input id="dz-tk" type="number" inputmode="numeric" value="'+st.kcal+'"></label>'
      +  '<label>חלבון ליום (ג׳)<input id="dz-tp" type="number" inputmode="numeric" value="'+st.protein+'"></label>'
      +  '<label>משקל יעד<input id="dz-tg" type="number" step="0.1" inputmode="decimal" value="'+st.goal+'"></label>'
      +  '<button class="dz-btn ghost" data-dz="savetargets">שמור</button></div>'
      +  '<div class="dz-sub">תקציב שבועי: '+dietNum(st.kcal*7,0)+' קל׳</div>';
    h += '<h3>מפתחות AI</h3><div class="dz-sub">נשמרים בקובץ dashboard-ai-keys.json בתיקייה אישי בדרייב שלך (לא ב-GitHub), ומגיעים לבד לכל מכשיר שמחובר לחשבון. אפשר להשתמש רק באחד מהם.</div>';
    h += '<div class="dz-form">'
      +  '<label>מפתח Gemini · <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">יצירת מפתח</a><input id="dz-kg" type="password" autocomplete="off" dir="ltr" value="'+esc(c.gemini)+'"></label>'
      +  '<label>מודל<input id="dz-mg" dir="ltr" autocomplete="off" value="'+esc(c.gModel)+'"></label></div>';
    h += '<div class="dz-form">'
      +  '<label>מפתח Claude · <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">יצירת מפתח</a><input id="dz-kc" type="password" autocomplete="off" dir="ltr" value="'+esc(c.claude)+'"></label>'
      +  '<label>מודל<input id="dz-mc" dir="ltr" autocomplete="off" value="'+esc(c.cModel)+'"></label></div>';
    h += '<div class="dz-row"><button class="dz-btn ghost" data-dz="savekeys">שמור מפתחות</button><span class="dz-sub" id="dz-keymsg"></span></div>';
    h += '<div class="dz-sub">'+dietAccuracy(dd)+'</div>';
    h += '<h3>מאכלים קבועים</h3><ul class="dz-mini">' + dd.foods.map(function(f){
      return '<li><span>'+esc(f.text)+'</span>'+dietPills(f.kcal, f.protein)+'<button class="dz-x" data-dz="delfood" data-v="'+esc(f.id)+'" aria-label="מחק '+esc(f.text)+'">✕</button></li>';
    }).join('') + '</ul><div class="dz-sub">מוסיפים מאכל קבוע מכל בדיקה, בכפתור ★.</div>';
    h += '<h3>ארוחות</h3><ul class="dz-mini">' + dd.meals.map(function(m){
      return '<li><span>'+esc((m.cat||'')+' · '+m.text)+'</span>'+dietPills(m.kcal, m.protein)+'<button class="dz-x" data-dz="delmeal" data-v="'+esc(m.id)+'" aria-label="מחק '+esc(m.text)+'">✕</button></li>';
    }).join('') + '</ul>';
    h += '<div class="dz-form">'
      +  '<label class="wide">ארוחה חדשה<input id="dz-nt" autocomplete="off" placeholder="למשל: עוף + בטטה + ירקות"></label>'
      +  '<label>מתי<select id="dz-nc">'+DIET_CATS.map(function(c){ return '<option>'+c+'</option>'; }).join('')+'</select></label>'
      +  '<label>קלוריות<input id="dz-nk" type="number" inputmode="numeric"></label>'
      +  '<label>חלבון<input id="dz-np" type="number" inputmode="numeric"></label>'
      +  '<button class="dz-btn ghost" data-dz="addmeal">הוסף</button></div>';
    h += '</div></details>';
    return h;
  }

  function dietAccuracy(dd){
    var n = 0, eg = 0, ec = 0;
    dd.log.forEach(function(x){
      if(x.g && x.c && x.kcal > 0){ n++; eg += Math.abs(x.g.k - x.kcal)/x.kcal; ec += Math.abs(x.c.k - x.kcal)/x.kcal; }
    });
    if(n < 5) return 'השוואה בין המודלים תופיע כאן אחרי 5 מנות שבדקו שניהם.';
    return 'מתוך '+n+' מנות שבדקו שניהם, ההערכה סטתה ממה שאישרת בממוצע: Gemini '+Math.round(eg/n*100)+'%, Claude '+Math.round(ec/n*100)+'%.';
  }

  function homeDietCard(state){
    var dd = dietData(state), today = dietToday(), days = dietWeek(dd, dietSunday(today));
    var room = dietRoom(dd, days, today), used = days.reduce(function(a, d){ return a+d.k; }, 0);
    var lw = dd.weights[dd.weights.length-1];
    var html = '<a class="home-card" href="#diet"><div class="hc-head"><h2>תזונה</h2><span class="arrow">‹</span></div><div class="hc-body">';
    html += '<div class="hc-task-row"><span>חלבון היום</span><span class="v num">'+room.day.p+' / '+dd.stats.protein+' ג׳</span></div>';
    html += '<div class="hc-task-row"><span>קלוריות השבוע</span><span class="v num">'+dietNum(used,0)+' / '+dietNum(dd.stats.kcal*7,0)+'</span></div>';
    html += '<div class="hc-task-row"><span>אפשר עוד היום</span><span class="v num">'+dietNum(room.left,0)+' קל׳</span></div>';
    if(lw) html += '<div class="hc-task-row"><span>משקל ← יעד</span><span class="v num">'+lw.kg.toFixed(1)+' ← '+dd.stats.goal+' ק״ג</span></div>';
    html += '</div></a>';
    return html;
  }

  /* --- the check box under the input (AI estimate, question, photo request, confirm) --- */
  function dietConfirmHTML(){
    var P = DIET_UI.pending;
    if(!P) return '';
    var img = P.img ? '<img class="dz-thumb" src="'+P.img+'" alt="">' : '';
    var cancel = '<button class="dz-btn ghost" data-dz="cancel">ביטול</button>';
    if(P.state === 'checking'){
      return '<div class="dz-confirm"><div class="dz-row">'+img+'<span class="dz-checking">בודק עם '+P.who.map(function(w){ return DIET_AI_NAMES[w]; }).join(' ו-')+'…</span></div></div>';
    }
    if(P.state === 'ask'){
      return '<div class="dz-confirm"><div class="dz-row">'+img+'<div class="dz-ask"><span class="dz-who">'+DIET_AI_NAMES[P.who]+' שואל</span> '+esc(P.q)+'</div></div>'
        + '<div class="dz-chips">'+P.opts.map(function(o, i){ return '<button class="dz-chip" data-dz="ans" data-v="'+i+'">'+esc(o)+'</button>'; }).join('')+'</div>'
        + '<div class="dz-row"><button class="dz-btn ghost" data-dz="guess">הערך בלי לענות</button>'+cancel+'</div></div>';
    }
    if(P.state === 'photo'){
      return '<div class="dz-confirm"><div class="dz-ask"><span class="dz-who">'+DIET_AI_NAMES[P.who]+'</span> '+esc(P.q)+'</div>'
        + '<div class="dz-row"><label class="dz-btn dz-cam">📷 צלם<input type="file" id="dz-photo2" accept="image/*" capture="environment"></label>'
        + '<button class="dz-btn ghost" data-dz="guess">הערך בכל זאת</button>'+cancel+'</div></div>';
    }
    var both = P.g && P.c, gap = both ? Math.abs(P.g.k-P.c.k)/Math.max(P.g.k, P.c.k, 1) : 0, agree = gap <= 0.15;
    var h = '<div class="dz-confirm"><div class="dz-row">'+img+'<input id="dz-cn" class="dz-cn" autocomplete="off" aria-label="שם המנה" value="'+esc(P.n||'')+'">'
      + (both ? '<span class="dz-agree '+(agree?'yes':'no')+'">'+(agree?'שני המודלים מסכימים':'פער של '+Math.round(gap*100)+'%: כדאי לבדוק')+'</span>' : '') + '</div>';
    if(P.g || P.c){
      h += '<div class="dz-models">' + ['gemini','claude'].filter(function(w){ return P[w[0]]; }).map(function(w){
        var e = P[w[0]];
        return '<div><span class="m">'+DIET_AI_NAMES[w]+'</span><b>'+e.k+'</b> קל׳ · <b>'+e.p+'</b> ג׳'+(e.as?'<small>'+esc(e.as)+'</small>':'')+'</div>';
      }).join('') + '</div>';
    }
    if(P.note) h += '<div class="dz-sub">'+esc(P.note)+'</div>';
    h += '<div class="dz-row"><label class="dz-lbl">קלוריות'+(both?' (ממוצע)':'')+'<input id="dz-ck" type="number" inputmode="numeric" value="'+(P.k==null?'':P.k)+'"></label>'
      +  '<label class="dz-lbl">חלבון (ג׳)<input id="dz-cp" type="number" inputmode="numeric" value="'+(P.p==null?'':P.p)+'"></label></div>';
    h += '<div class="dz-impact" id="dz-impact"></div>';
    h += '<div class="dz-row"><button class="dz-btn" data-dz="add">הוסף ליום</button><button class="dz-btn ghost" data-dz="fav" title="מוסיף ליום וגם שומר כמאכל קבוע">★ הוסף ושמור כקבוע</button><button class="dz-btn ghost" data-dz="cancel">רק בדקתי</button></div></div>';
    return h;
  }
  function dietPaintConfirm(){
    var el = document.getElementById('dz-confirm');
    if(!el) return;
    el.innerHTML = dietConfirmHTML();
    dietImpact();
  }
  function dietImpact(){
    var el = document.getElementById('dz-impact');
    if(!el) return;
    var k = parseFloat((document.getElementById('dz-ck')||{}).value)||0, p = parseFloat((document.getElementById('dz-cp')||{}).value)||0;
    var dd = dietData(STATE), iso = DIET_UI.sel || dietToday();
    var room = dietRoom(dd, dietWeek(dd, dietSunday(iso)), iso);
    var after = room.left - k, pl = Math.round(dd.stats.protein - room.day.p - p);
    el.innerHTML = 'אם תוסיף: ' + (after >= 0
        ? 'נשארות עוד <b>'+dietNum(after,0)+'</b> קל׳ ליום'
        : '<b class="dz-warn">חריגה של '+dietNum(-after,0)+' קל׳</b> מהמכסה של היום (יתקזז בשאר השבוע)')
      + ' · ' + (pl > 0 ? 'חסרים <b>'+pl+'</b> ג׳ חלבון' : '<b class="dz-ok">יעד החלבון הושג</b>');
  }

  /* --- AI --- */
  function dietAIConf(){
    var c = {};
    try{ c = JSON.parse(localStorage.getItem('dietAI')) || {}; }catch(e){}
    // gemini-2.5-flash was closed to new keys (Nov 2026): a saved old name moves to the current default.
    var gm = (!c.gModel || c.gModel === 'gemini-2.5-flash') ? 'gemini-3.8-flash' : c.gModel;
    return {gemini: c.gemini||'', claude: c.claude||'', gModel: gm, cModel: c.cModel||'claude-haiku-4-5'};
  }
  function dietPrompt(text, img, answer, noAsk){
    var foods = dietData(STATE).foods.map(function(f){ return f.text+': '+f.kcal+' קל׳, '+f.protein+' ג׳ חלבון'; }).join('; ');
    return [
      'אתה עוזר תזונה. משתמש בישראל (גבר, 27, כ-80 ק״ג, בדיאטה) רושם מה אכל. העריך את הקלוריות והחלבון של מה שמתואר'+(img?' ומה שרואים בתמונה':'')+'.',
      'תיאור: «'+(text || (img ? 'אין תיאור, רק תמונה' : ''))+'»',
      answer ? 'תשובת המשתמש לשאלת ההבהרה: «'+answer+'»' : '',
      foods ? 'לעיון, ערכים שהמשתמש כבר אישר למאכלים שלו: '+foods+'.' : '',
      'השתמש בערכים של מוצרים ומנות נפוצים בישראל. אם יש כמה פריטים, סכם הכל למנה אחת.',
      noAsk
        ? 'חובה להחזיר status "ok" עם ההערכה הטובה ביותר.'
        : 'החזר status "ask" רק אם חסר פרט (בעיקר כמות) שמשנה את ההערכה ביותר מ-25%, עם שאלה קצרה ו-2 עד 4 תשובות קצרות שמכסות את הטווח. החזר status "photo" רק אם בלי לראות את המנה אי אפשר להעריך בכלל. אחרת status "ok".',
      'החזר JSON בלבד, בלי שום טקסט נוסף: {"status":"ok|ask|photo","name":"שם קצר בעברית","kcal":0,"protein":0,"assumptions":"הכמויות שהנחת, קצר, בעברית","question":"","options":[]}'
    ].filter(Boolean).join('\n');
  }
  function dietParseAI(txt){
    var m = String(txt||'').match(/\{[\s\S]*\}/);
    if(!m) throw new Error('תשובה לא צפויה');
    var j = JSON.parse(m[0]);
    return {
      status: ['ok','ask','photo'].indexOf(j.status) >= 0 ? j.status : 'ok',
      name: String(j.name||'').trim(),
      kcal: j.kcal==null || isNaN(+j.kcal) ? null : Math.round(+j.kcal),
      protein: j.protein==null || isNaN(+j.protein) ? null : Math.round(+j.protein),
      as: String(j.assumptions||'').trim(),
      question: String(j.question||'').trim(),
      options: Array.isArray(j.options) ? j.options.map(String).filter(Boolean).slice(0,4) : []
    };
  }
  function dietFetch(url, opts){
    var ctl = new AbortController(), t = setTimeout(function(){ ctl.abort(); }, 30000);
    opts.signal = ctl.signal;
    return fetch(url, opts).then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(j){
        if(!r.ok) throw new Error((j.error && j.error.message) || ('HTTP '+r.status));
        return j;
      });
    }).finally(function(){ clearTimeout(t); });
  }
  // Gemini Interactions API (generateContent is being retired for new keys).
  var DIET_SCHEMA = {type: 'object', properties: {
    status: {type: 'string', enum: ['ok','ask','photo']}, name: {type: 'string'}, kcal: {type: 'integer'}, protein: {type: 'integer'},
    assumptions: {type: 'string'}, question: {type: 'string'}, options: {type: 'array', items: {type: 'string'}}
  }, required: ['status','name','kcal','protein','assumptions']};
  function dietGemini(conf, prompt, img){
    var input = [];
    if(img) input.push({type: 'image', mime_type: 'image/jpeg', data: img.split(',')[1]});
    input.push({type: 'text', text: prompt});
    return dietFetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'x-goog-api-key': conf.gemini},
      body: JSON.stringify({model: conf.gModel, input: input, response_format: {type: 'text', mime_type: 'application/json', schema: DIET_SCHEMA}})
    }).then(function(j){
      var txt = '';
      (j.steps || []).forEach(function(st){
        if(st.type === 'model_output') (st.content || []).forEach(function(c){ if(c.type === 'text') txt += c.text || ''; });
      });
      if(!txt && Array.isArray(j.outputs)) j.outputs.forEach(function(c){ if(c.type === 'text') txt += c.text || ''; });
      if(!txt && j.output_text) txt = j.output_text;
      return dietParseAI(txt);
    });
  }
  function dietClaude(conf, prompt, img){
    var content = [];
    if(img) content.push({type: 'image', source: {type: 'base64', media_type: 'image/jpeg', data: img.split(',')[1]}});
    content.push({type: 'text', text: prompt});
    return dietFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {'content-type': 'application/json', 'x-api-key': conf.claude, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true'},
      body: JSON.stringify({model: conf.cModel, max_tokens: 500, messages: [{role: 'user', content: content}]})
    }).then(function(j){
      return dietParseAI((j.content||[]).filter(function(b){ return b.type === 'text'; }).map(function(b){ return b.text; }).join(''));
    });
  }
  // Runs both models in parallel. A newer run (more typing) makes older answers stale via `seq`.
  function dietRun(text, img, answer, noAsk){
    clearTimeout(DIET_UI.timer);
    var my = ++DIET_UI.seq, conf = dietAIConf();
    var who = [];
    if(conf.gemini) who.push('gemini');
    if(conf.claude) who.push('claude');
    var base = {text: text, img: img||null};
    var manual = function(note){ DIET_UI.pending = Object.assign({}, base, {state: 'done', n: text, k: null, p: null, note: note}); dietPaintConfirm(); };
    if(!who.length) return manual('אין מפתח AI. אפשר להזין את המספרים ידנית, או להגדיר מפתח בהגדרות למטה.');
    if(navigator.onLine === false) return manual('אין רשת. אפשר להזין את המספרים ידנית.');
    DIET_UI.pending = Object.assign({}, base, {state: 'checking', who: who});
    dietPaintConfirm();
    var prompt = dietPrompt(text, img, answer, noAsk || !!answer);
    Promise.all(who.map(function(w){
      return (w === 'gemini' ? dietGemini : dietClaude)(conf, prompt, img)
        .then(function(r){ return {w: w, r: r}; }, function(e){ return {w: w, err: (e && e.name === 'AbortError') ? 'לא ענה בזמן' : ((e && e.message) || 'שגיאה')}; });
    })).then(function(res){
      if(my !== DIET_UI.seq) return;
      var by = {};
      res.forEach(function(x){ by[x.w] = x; });
      var oks = res.filter(function(x){ return x.r; });
      var errs = res.filter(function(x){ return x.err; }).map(function(x){ return DIET_AI_NAMES[x.w]+': '+x.err; }).join(' · ');
      if(!oks.length) return manual('הבדיקה נכשלה ('+errs+'). אפשר להזין ידנית.');
      if(!noAsk && !answer){
        var ask = ['claude','gemini'].map(function(w){ return by[w]; }).find(function(x){ return x && x.r && x.r.status === 'ask' && x.r.question && x.r.options.length >= 2; });
        if(ask){ DIET_UI.pending = Object.assign({}, base, {state: 'ask', who: ask.w, q: ask.r.question, opts: ask.r.options}); return dietPaintConfirm(); }
        var ph = !img && oks.find(function(x){ return x.r.status === 'photo'; });
        if(ph){ DIET_UI.pending = Object.assign({}, base, {state: 'photo', who: ph.w, q: ph.r.question || 'קשה להעריך בלי לראות. אפשר לצלם את המנה?'}); return dietPaintConfirm(); }
      }
      var est = oks.filter(function(x){ return x.r.kcal != null; });
      if(!est.length){ if(!noAsk && !answer) return dietRun(text, img, answer, true); return manual('לא התקבלה הערכה. אפשר להזין ידנית.'); }
      var g = by.gemini && by.gemini.r && by.gemini.r.kcal != null ? by.gemini.r : null;
      var c = by.claude && by.claude.r && by.claude.r.kcal != null ? by.claude.r : null;
      var pick = function(e){ return e ? {k: e.kcal, p: e.protein||0, as: e.as} : null; };
      var list = [g, c].filter(Boolean);
      DIET_UI.pending = Object.assign({}, base, {
        state: 'done', n: (c && c.name) || (g && g.name) || text || 'מנה',
        k: Math.round(dietSum(list, 'kcal')/list.length), p: Math.round(dietSum(list, 'protein')/list.length),
        g: pick(g), c: pick(c), note: errs ? 'לא ענה: '+errs : ''
      });
      dietPaintConfirm();
    });
  }
  function dietImg(file, cb){
    var r = new FileReader();
    r.onload = function(){
      var im = new Image();
      im.onload = function(){
        var s = Math.min(1, 1024/Math.max(im.width, im.height));
        var cv = document.createElement('canvas');
        cv.width = Math.round(im.width*s); cv.height = Math.round(im.height*s);
        cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
        cb(cv.toDataURL('image/jpeg', 0.8));
      };
      im.onerror = function(){ cb(null); };
      im.src = r.result;
    };
    r.readAsDataURL(file);
  }

  /* --- changes --- */
  function dietEnsure(){ if(!STATE.diet) STATE.diet = {}; return STATE.diet; }
  function dietAdd(item){
    var d = dietEnsure();
    item.id = 'dl_'+Date.now()+'_'+Math.floor(Math.random()*1000);
    item.date = DIET_UI.sel || dietToday();
    d.log = (d.log||[]).concat([item]);
    scheduleSave();
  }
  function dietCommit(fav){
    var P = DIET_UI.pending;
    if(!P) return;
    var ck = document.getElementById('dz-ck'), cp = document.getElementById('dz-cp');
    var k = parseFloat(ck && ck.value), p = parseFloat(cp && cp.value);
    if(isNaN(k)){ if(ck) ck.focus(); return; }
    if(isNaN(p)) p = 0;
    var name = ((document.getElementById('dz-cn')||{}).value||'').trim() || P.text || 'מנה';
    var item = {text: name, kcal: Math.round(k), protein: Math.round(p), src: (P.g||P.c) ? 'ai' : 'manual'};
    var as = (P.c && P.c.as) || (P.g && P.g.as);
    if(as) item.as = as;
    if(P.g) item.g = {k: P.g.k, p: P.g.p};
    if(P.c) item.c = {k: P.c.k, p: P.c.p};
    if(fav){
      var d = dietEnsure();
      d.foods = (d.foods||[]).concat([{id: 'df_'+Date.now(), text: name, kcal: item.kcal, protein: item.protein}]);
    }
    DIET_UI.pending = null; DIET_UI.draft = ''; DIET_UI.seq++;
    dietAdd(item);
  }
  function dietVal(id){ var el = document.getElementById(id); return el ? el.value.trim() : ''; }

  function dietOnClick(e){
    var sm = e.target.closest('#dz-settings > summary');
    if(sm){ DIET_UI.settings = !sm.parentNode.open; return; }
    var b = e.target.closest('[data-dz]');
    if(!b) return;
    var a = b.getAttribute('data-dz'), v = b.getAttribute('data-v'), P = DIET_UI.pending, d, dd = dietData(STATE);
    if(a === 'day'){ DIET_UI.sel = v; render(); }
    else if(a === 'week'){
      var o = DIET_UI.weekOff + (+v);
      if(o > 0) return;
      DIET_UI.weekOff = o; DIET_UI.sel = null; render();
    }
    else if(a === 'food' || a === 'meal'){
      var src = (a === 'food' ? dd.foods : dd.meals).find(function(x){ return x.id === v; });
      if(src) dietAdd({text: src.text, kcal: src.kcal, protein: src.protein, src: a});
    }
    else if(a === 'del'){ d = dietEnsure(); d.log = (d.log||[]).filter(function(x){ return x.id !== v; }); scheduleSave(); }
    else if(a === 'ans'){ if(P && P.opts) dietRun(P.text, P.img, P.opts[+v]); }
    else if(a === 'guess'){ if(P) dietRun(P.text, P.img, null, true); }
    else if(a === 'cancel'){ DIET_UI.seq++; DIET_UI.pending = null; dietPaintConfirm(); }
    else if(a === 'add' || a === 'fav'){ dietCommit(a === 'fav'); }
    else if(a === 'wsave'){
      var w = parseFloat(dietVal('dz-w'));
      if(isNaN(w) || w < 30 || w > 250) return;
      var sun = dietSunday(dietToday()), id = 'w_'+sun;
      d = dietEnsure();
      var ws = (d.weights||[]).filter(function(x){ return x.id !== id; });
      ws.push({id: id, date: sun, kg: Math.round(w*10)/10});
      ws.sort(function(x, y){ return x.date < y.date ? -1 : 1; });
      d.weights = ws; scheduleSave();
    }
    else if(a === 'delw'){ d = dietEnsure(); d.weights = (d.weights||[]).filter(function(x){ return x.id !== v; }); scheduleSave(); }
    else if(a === 'savetargets'){
      var tk = parseFloat(dietVal('dz-tk')), tp = parseFloat(dietVal('dz-tp')), tg = parseFloat(dietVal('dz-tg'));
      d = dietEnsure();
      var st = Object.assign({}, d.stats||{});
      if(!isNaN(tk) && tk > 0) st.kcal = tk;
      if(!isNaN(tp) && tp > 0) st.protein = tp;
      if(!isNaN(tg) && tg > 0) st.goal = tg;
      d.stats = st; scheduleSave();
    }
    else if(a === 'savekeys'){
      var msg = document.getElementById('dz-keymsg');
      try{
        localStorage.setItem('dietAI', JSON.stringify({gemini: dietVal('dz-kg'), claude: dietVal('dz-kc'), gModel: dietVal('dz-mg') || 'gemini-3.8-flash', cModel: dietVal('dz-mc') || 'claude-haiku-4-5', updatedAt: Date.now()}));
      }catch(err){ if(msg) msg.textContent = 'הדפדפן לא מאפשר לשמור כאן'; return; }
      if(msg) msg.textContent = 'שומר בדרייב…';
      var done = function(ok){ if(msg) msg.textContent = ok ? 'נשמר בדרייב, יגיע לכל המכשירים שלך' : 'נשמר כאן, יעלה לדרייב בסנכרון הבא'; };
      Promise.resolve(window.__DASH__.saveSecrets ? window.__DASH__.saveSecrets() : false).then(done, function(){ done(false); });
    }
    else if(a === 'delfood'){ d = dietEnsure(); d.foods = (d.foods||[]).filter(function(x){ return x.id !== v; }); scheduleSave(); }
    else if(a === 'delmeal'){ d = dietEnsure(); d.meals = (d.meals||[]).filter(function(x){ return x.id !== v; }); scheduleSave(); }
    else if(a === 'addmeal'){
      var t = dietVal('dz-nt'), nk = parseFloat(dietVal('dz-nk')), np = parseFloat(dietVal('dz-np'));
      if(!t || isNaN(nk)) return;
      d = dietEnsure();
      d.meals = (d.meals||[]).concat([{id: 'dm_'+Date.now(), cat: dietVal('dz-nc') || 'צהריים', text: t, kcal: Math.round(nk), protein: isNaN(np) ? 0 : Math.round(np)}]);
      scheduleSave();
    }
  }
  function dietOnInput(e){
    var t = e.target;
    if(t.id === 'dz-q'){
      DIET_UI.draft = t.value;
      clearTimeout(DIET_UI.timer);
      var v = t.value.trim(), img = DIET_UI.pending && DIET_UI.pending.img;
      if(!v){
        if(DIET_UI.pending && !img){ DIET_UI.seq++; DIET_UI.pending = null; dietPaintConfirm(); }
        return;
      }
      DIET_UI.timer = setTimeout(function(){ dietRun(v, img); }, 1500);
    }
    else if(t.id === 'dz-ck' || t.id === 'dz-cp') dietImpact();
  }
  function dietOnKey(e){
    if(e.key !== 'Enter' || !e.target || e.target.id !== 'dz-q') return;
    e.preventDefault();
    var v = e.target.value.trim();
    if(v) dietRun(v, DIET_UI.pending && DIET_UI.pending.img);
  }
  function dietOnChange(e){
    var t = e.target;
    if(t.id !== 'dz-photo' && t.id !== 'dz-photo2') return;
    var f = t.files && t.files[0];
    t.value = '';
    if(!f) return;
    var text = (DIET_UI.draft||'').trim() || (DIET_UI.pending && DIET_UI.pending.text) || '';
    dietImg(f, function(data){ if(data) dietRun(text, data); });
  }

  function bindDiet(){
    if(!DIET_UI.bound){
      DIET_UI.bound = true;
      document.addEventListener('click', dietOnClick);
      document.addEventListener('input', dietOnInput);
      document.addEventListener('keydown', dietOnKey);
      document.addEventListener('change', dietOnChange);
    }
    var q = document.getElementById('dz-q');
    if(!q) return;
    dietImpact();
    if(DIET_UI.refocus){
      q.focus();
      var n = q.value.length;
      try{ q.setSelectionRange(n, n); }catch(e){}
      DIET_UI.refocus = false;
    }
  }

  /* --- one-time setup (09.11.2026: the principles page became a tracker) and log pruning --- */
  function ensureDietDefaults(){
    if(!STATE.sports || !(STATE.sports.days||[]).length) return false; // data not loaded yet
    var changed = false, d = STATE.diet || {};
    if(d.v !== 2){
      var st = d.stats || {};
      STATE.diet = {
        v: 2,
        stats: {kcal: st.kcal||1800, protein: st.protein||135, goal: st.goal||72, pace: st.pace||0.8},
        log: d.log || [],
        weights: (d.weights && d.weights.length) ? d.weights : [{id: 'w_2026-11-01', date: '2026-11-01', kg: st.weight||80}],
        foods: [
          {id: 'df_1', text: 'סקופ חלבון', kcal: 120, protein: 24},
          {id: 'df_2', text: 'גביע קוטג׳ 5%', kcal: 245, protein: 26},
          {id: 'df_3', text: 'יוגורט חלבון', kcal: 150, protein: 20},
          {id: 'df_4', text: 'קופסת טונה במים', kcal: 120, protein: 26},
          {id: 'df_5', text: 'ביצה', kcal: 75, protein: 6},
          {id: 'df_6', text: 'פרי', kcal: 90, protein: 1},
          {id: 'df_7', text: 'פריכייה', kcal: 35, protein: 1}
        ],
        meals: [
          {id: 'dm_1', cat: 'בוקר', text: 'יוגורט חלבון + פירות + חמאת בוטנים', kcal: 330, protein: 26, note: 'יוגורט 200 ג׳, חופן פירות, כפית חמאת בוטנים או צ׳יה'},
          {id: 'dm_2', cat: 'בוקר', text: 'טונה + חצי קוטג׳ + 3 פריכיות', kcal: 330, protein: 40},
          {id: 'dm_3', cat: 'צהריים', text: 'עוף + תפוח אדמה + ירקות אפויים', kcal: 700, protein: 50, note: '200 ג׳ חזה עוף נא · 300 ג׳ תפו״א · 300 ג׳ ירקות · כפית שמן'},
          {id: 'dm_4', cat: 'צהריים', text: 'בקר טחון + אורז + ירקות', kcal: 720, protein: 48, note: '200 ג׳ בקר 5% נא · 180 ג׳ אורז מבושל · 300 ג׳ ירקות'},
          {id: 'dm_5', cat: 'צהריים', text: 'סלמון + תפוח אדמה + ירקות', kcal: 680, protein: 35, note: '150 ג׳ סלמון · 200 ג׳ תפו״א · 300 ג׳ ירקות'},
          {id: 'dm_6', cat: 'צהריים', text: 'עוף + פסטה + ירקות', kcal: 700, protein: 50, note: '200 ג׳ חזה עוף נא · 160 ג׳ פסטה מבושלת'},
          {id: 'dm_7', cat: 'צהריים', text: 'שישי: חלבון + ירקות, בלי פחמימה', kcal: 400, protein: 45},
          {id: 'dm_8', cat: 'ערב', text: 'חביתה + 2 פרוסות + סלט', kcal: 380, protein: 22},
          {id: 'dm_9', cat: 'ערב', text: 'טוסט פסטו וגבינה', kcal: 300, protein: 20, note: 'כף שטוחה פסטו · 40 ג׳ צהובה 9%'},
          {id: 'dm_10', cat: 'ערב', text: 'סלט גדול + טונה', kcal: 280, protein: 30}
        ],
        principles: [], rules: [], prep: [], menu: []
      };
      changed = true;
    }
    if(dietPruneLog()) changed = true;
    return changed;
  }
  function dietPruneLog(){
    var d = STATE.diet, log = (d && d.log) || [], cut = dietAddDays(dietToday(), -DIET_KEEP_DAYS);
    var old = log.filter(function(x){ return x.date < cut && !x.sum; });
    if(!old.length) return false;
    var keep = log.filter(function(x){ return !(x.date < cut && !x.sum); });
    var by = {};
    old.forEach(function(x){ (by[x.date] = by[x.date] || []).push(x); });
    Object.keys(by).forEach(function(dt){
      var k = dietSum(by[dt], 'kcal'), p = dietSum(by[dt], 'protein');
      var ex = keep.find(function(y){ return y.id === 'ds_'+dt; });
      if(ex){ ex.kcal += k; ex.protein += p; }
      else keep.push({id: 'ds_'+dt, date: dt, text: 'סיכום יום', kcal: k, protein: p, sum: true});
    });
    d.log = keep;
    return true;
  }

  /* ---------- ROUTER ---------- */
  var routes = {
    '': homeHTML,
    '#': homeHTML,
    '#home': homeHTML,
    '#tasks': tasksPageHTML,
    '#finance': financePageHTML,
    '#debts': debtsPageHTML,
    '#sports': sportsPageHTML,
    '#leisure': leisurePageHTML,
    '#diet': dietPageHTML
  };

  function currentRoute(){
    // Prefer the live URL hash (normal in-page navigation). If it's empty —
    // which happens right after the platform reloads this view to a freshly
    // published version — fall back to a route remembered in this browser
    // tab only (sessionStorage), so an in-progress edit isn't bounced back
    // to the home page. This is deliberately NOT read from the shared
    // published STATE: opening the dashboard link fresh (a new tab/session,
    // or anyone else opening it) should always land on the home page.
    if(window.location.hash) return window.location.hash;
    try{
      return sessionStorage.getItem('lastRoute') || '';
    }catch(e){
      return '';
    }
  }

  /* ---------- DRAG-TO-REORDER (Google Keep style press-and-drag) ----------
     Generic helper: press/hold on a handle element and drag vertically to
     reorder its item among its siblings inside containerEl. Works for mouse,
     touch and pen via Pointer Events. The DOM is reordered live (direct
     insertBefore swaps, no transform animation) purely for feedback; nothing
     is written to STATE until pointerup, when onDrop(finalItems) is called
     so the caller can commit the new order and scheduleSave() once. */
  function initDragReorder(containerEl, itemSelector, handleSelector, onDrop){
    if(!containerEl) return;
    containerEl.querySelectorAll(handleSelector).forEach(function(handle){
      var item = handle.closest(itemSelector);
      if(!item) return;
      handle.addEventListener('pointerdown', function(e){
        if(e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        var dragging = item;
        dragging.classList.add('dragging');
        var startOrder = null;
        // Listeners live on document (not on the handle, and no
        // setPointerCapture) because the handle's own DOM position moves
        // during the drag as items get reordered — a captured/moving
        // element can make the browser fire a premature pointercancel and
        // cut the drag short after a single swap.

        function items(){ return Array.prototype.slice.call(containerEl.querySelectorAll(itemSelector)); }

        var isGrid = containerEl.classList && containerEl.classList.contains('grid-list');
        function onMove(ev){
          if(isGrid){
            var hit = document.elementFromPoint(ev.clientX, ev.clientY);
            var target = hit && hit.closest ? hit.closest(itemSelector) : null;
            if(!target || target===dragging || target.parentNode!==containerEl) return;
            var all = items();
            if(all.indexOf(dragging) < all.indexOf(target)){ containerEl.insertBefore(dragging, target.nextSibling); }
            else { containerEl.insertBefore(dragging, target); }
            return;
          }
          var y = ev.clientY;
          var list = items();
          var idx = list.indexOf(dragging);
          if(idx === -1) return;
          var prev = list[idx-1];
          if(prev){
            var pr = prev.getBoundingClientRect();
            if(y < pr.top + pr.height/2){ containerEl.insertBefore(dragging, prev); return; }
          }
          var next = list[idx+1];
          if(next){
            var nr = next.getBoundingClientRect();
            if(y > nr.top + nr.height/2){ containerEl.insertBefore(dragging, next.nextSibling); }
          }
        }
        function onUp(){
          dragging.classList.remove('dragging');
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          document.removeEventListener('pointercancel', onUp);
          // Only save when the order actually changed — an accidental touch
          // on a handle no longer triggers a needless save/republish.
          var finalItems = items();
          var changed = finalItems.some(function(el, i){ return el !== startOrder[i]; });
          if(changed) onDrop(finalItems);
        }
        startOrder = items();
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
      });
    });
  }

  function render(){
    var hash = currentRoute();
    var fn = routes[hash] || homeHTML;
    var appEl = document.getElementById('app');
    document.documentElement.classList.toggle('fin-dark', fn === financePageHTML);
    appEl.innerHTML = fn(STATE);
    // Usage instructions live at the bottom of each page, not under the title.
    var help = appEl.querySelector('.page-head .sub.help');
    if(help){
      var box = document.createElement('div');
      box.className = 'page-help';
      box.innerHTML = '<div class="page-help-title">איך משתמשים בדף</div>' + help.innerHTML;
      help.remove();
      appEl.appendChild(box);
    }
    bind();
    bindCalWatches();
  }

  /* Click-to-edit: every [data-inline] element is a contenteditable span
     that looks like plain text. Click it to edit in place; Enter or
     clicking away saves, Esc reverts. Empty text is rejected for required
     fields (task/item/exercise names) and reverts to the previous value. */
  function bindInlineEdit(el, allowEmpty, onCommit){
    var original = el.textContent;
    el.addEventListener('focus', function(){
      original = el.textContent;
      el.classList.remove('is-empty');
    });
    el.addEventListener('keydown', function(e){
      if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); el.blur(); }
      else if(e.key==='Escape'){ e.preventDefault(); el.textContent = original; el.blur(); }
    });
    el.addEventListener('paste', function(e){
      // Fallback for browsers without plaintext-only: keep pasted content as plain text.
      if(!e.clipboardData) return;
      e.preventDefault();
      var txt = e.clipboardData.getData('text/plain').replace(/\s*\n\s*/g,' ');
      document.execCommand('insertText', false, txt);
    });
    el.addEventListener('blur', function(){
      var v = el.textContent.replace(/\s+/g,' ').trim();
      if(v === original.replace(/\s+/g,' ').trim()){
        el.textContent = original;
        if(!v && el.classList.contains('inline-note')) el.classList.add('is-empty');
        return;
      }
      if(!v && !allowEmpty){ el.textContent = original; return; }
      onCommit(v);
    });
  }

  function bindAllInlineEdits(){
    document.querySelectorAll('[data-inline]').forEach(function(el){
      var kind = el.getAttribute('data-inline');
      if(kind === 'tasktext'){
        bindInlineEdit(el, false, function(v){
          var t = STATE.tasks.find(function(x){return x.id===el.getAttribute('data-task');});
          if(!t) return;
          t.text = v; scheduleSave();
        });
      } else if(kind === 'exname' || kind === 'exsr'){
        bindInlineEdit(el, kind === 'exsr', function(v){
          var d = STATE.sports.days.find(function(x){return x.id===el.getAttribute('data-day');});
          if(!d) return;
          var ex = d.exercises[parseInt(el.getAttribute('data-ex'),10)];
          if(!ex) return;
          if(kind === 'exname') ex.name = v; else ex.setsReps = v;
          scheduleSave();
        });
      } else if(kind === 'dayname'){
        bindInlineEdit(el, false, function(v){
          var d = STATE.sports.days.find(function(x){return x.id===el.getAttribute('data-day');});
          if(!d) return;
          d.name = v;
          (STATE.sports.workoutLog||[]).forEach(function(w){ if(w.dayId===d.id) w.dayName = v; });
          scheduleSave();
        });
      } else if(kind === 'debtperson' || kind === 'debtitem' || kind === 'debtnote'){
        bindInlineEdit(el, kind === 'debtnote', function(v){
          var d = STATE.debts.find(function(x){return x.id===el.getAttribute('data-debt');});
          if(!d) return;
          if(kind === 'debtperson') d.person = v;
          else if(kind === 'debtitem') d.item = v;
          else { if(v) d.note = v; else delete d.note; }
          scheduleSave();
        });
      } else if(kind === 'leisuretext' || kind === 'leisurenote'){
        var section = el.getAttribute('data-section');
        var id = el.getAttribute('data-item');
        bindInlineEdit(el, kind === 'leisurenote', function(v){
          var it = ((STATE.leisure && STATE.leisure[section]) || []).find(function(x){return x.id===id;});
          if(!it) return;
          if(kind === 'leisuretext'){ it.text = v; scheduleSave(); return; }
          var autoFill = el.getAttribute('data-autofill') === '1';
          if(v){
            it.note = v;
            it.authorPending = false;
            delete it.authorUnknown;
            scheduleSave();
          } else {
            delete it.note;
            if(autoFill){
              // Author cleared — let Claude look it up automatically, as on add.
              it.authorPending = true;
              delete it.authorUnknown;
              scheduleSave();
              lookupBookAuthor(section, id);
            } else {
              scheduleSave();
            }
          }
        });
      }
    });
  }

  function bind(){
    bindAllInlineEdits();
    bindDiet();
    document.querySelectorAll('input[data-action="done"]').forEach(function(cb){
      cb.addEventListener('change', function(){
        var id = cb.getAttribute('data-task');
        STATE.tasks = STATE.tasks.filter(function(t){return t.id!==id;});
        scheduleSave();
      });
    });
    document.querySelectorAll('.star-btn[data-action="urgent"]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var id = btn.getAttribute('data-task');
        var idx = STATE.tasks.findIndex(function(x){return x.id===id;});
        if(idx === -1) return;
        var t = STATE.tasks[idx];
        var wasUrgent = t.urgent;
        t.urgent = !t.urgent;
        if(t.urgent && !wasUrgent){
          // Jumps to the top of its own category: pull it out and reinsert
          // right before the first other task that shares its category.
          STATE.tasks.splice(idx, 1);
          var insertAt = STATE.tasks.findIndex(function(x){return x.cat===t.cat;});
          STATE.tasks.splice(insertAt===-1 ? STATE.tasks.length : insertAt, 0, t);
        }
        scheduleSave();
      });
    });
    document.querySelectorAll('select[data-action="movecat"]').forEach(function(sel){
      sel.addEventListener('change', function(){
        var id = sel.getAttribute('data-task');
        var t = STATE.tasks.find(function(x){return x.id===id;});
        if(!t) return;
        if(sel.value === '__new__'){
          var wrap = document.createElement('span');
          wrap.className = 'w-edit-row';
          wrap.style.display = 'inline-flex';
          wrap.innerHTML = '<input type="text" placeholder="שם קטגוריה חדשה" style="width:110px;font-family:\'Rubik\',sans-serif;font-size:12px;padding:4px 7px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);" /><button type="button">אישור</button>';
          sel.replaceWith(wrap);
          var inp = wrap.querySelector('input');
          var confirmBtn = wrap.querySelector('button');
          inp.focus();
          var commit = function(){
            var v = inp.value.trim();
            if(v){ t.cat = v; scheduleSave(); } else { render(); }
          };
          confirmBtn.addEventListener('click', commit);
          inp.addEventListener('keydown', function(e){ if(e.key==='Enter'){ commit(); } if(e.key==='Escape'){ render(); } });
        } else {
          t.cat = sel.value;
          scheduleSave();
        }
      });
    });
    initDragReorder(document.getElementById('tasks-cat-list'), '.task-cat-group', '.task-cat .drag-hint', function(list){
      STATE.categoryOrder = list.map(function(el){ return el.getAttribute('data-cat'); });
      scheduleSave();
    });
    document.querySelectorAll('.task-cat-group').forEach(function(group){
      var ul = group.querySelector('ul.tasks');
      var cat = group.getAttribute('data-cat');
      initDragReorder(ul, 'li', '.task-drag-handle', function(list){
        var ids = list.map(function(li){ return li.getAttribute('data-task'); });
        reorderCategoryTasks(cat, ids);
        scheduleSave();
      });
    });
    document.querySelectorAll('.cal-btn[data-action="callink"]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var id = btn.getAttribute('data-task');
        var t = STATE.tasks.find(function(x){return x.id===id;});
        if(!t) return;
        openCalLinkPanel(btn, t);
      });
    });
    document.querySelectorAll('[data-action="calunlink"]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var id = btn.getAttribute('data-task');
        var t = STATE.tasks.find(function(x){return x.id===id;});
        if(!t) return;
        delete t.cal;
        scheduleSave();
      });
    });
    document.querySelectorAll('.note-input[data-action="note"]').forEach(function(inp){
      var committed = inp.value;
      inp.addEventListener('keydown', function(e){
        if(e.key==='Enter'){ inp.blur(); }
        if(e.key==='Escape'){ inp.value = committed; inp.blur(); }
      });
      inp.addEventListener('blur', function(){
        var id = inp.getAttribute('data-task');
        var t = STATE.tasks.find(function(x){return x.id===id;});
        if(!t) return;
        var v = inp.value.trim();
        if(v !== (t.note || '')){
          t.note = v;
          scheduleSave();
        }
      });
    });
    var addBtn = document.querySelector('[data-action="addtask"]');
    if(addBtn){
      var doAdd = function(){
        var txtEl = document.querySelector('input[name="txt"]');
        var catEl = document.querySelector('input[name="cat"]');
        var txt = txtEl.value.trim();
        var cat = catEl.value.trim() || 'כללי';
        if(!txt) return;
        STATE.tasks.push({id:'t_'+Date.now()+'_'+Math.floor(Math.random()*1000), cat:cat, text:txt, urgent:false});
        scheduleSave();
      };
      addBtn.addEventListener('click', doAdd);
      document.querySelectorAll('.add-task-row input[type=text]').forEach(function(inp){
        inp.addEventListener('keydown', function(e){ if(e.key==='Enter'){ doAdd(); } });
      });
    }
    var addDebtBtn = document.querySelector('[data-action="adddebt"]');
    if(addDebtBtn){
      var debtRow = addDebtBtn.closest('.debt-add-row');
      var doAddDebt = function(){
        var person = debtRow.querySelector('input[name="debtperson"]').value.trim();
        var item = debtRow.querySelector('input[name="debtitem"]').value.trim();
        var note = debtRow.querySelector('input[name="debtnote"]').value.trim();
        var dir = debtRow.querySelector('select[name="debtdir"]').value;
        if(!person || !item) return;
        var d = {id:'d_'+Date.now()+'_'+Math.floor(Math.random()*1000), direction:dir, person:person, item:item};
        if(note) d.note = note;
        if(!STATE.debts) STATE.debts = [];
        STATE.debts.push(d);
        scheduleSave();
      };
      addDebtBtn.addEventListener('click', doAddDebt);
      debtRow.querySelectorAll('input').forEach(function(inp){
        inp.addEventListener('keydown', function(e){ if(e.key==='Enter'){ doAddDebt(); } });
      });
    }
    document.querySelectorAll('[data-action="deldebt"]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var id = btn.getAttribute('data-debt');
        STATE.debts = (STATE.debts||[]).filter(function(d){return d.id!==id;});
        scheduleSave();
      });
    });
    document.querySelectorAll('.log-btn[data-action="logday"]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var id = btn.getAttribute('data-day');
        var d = STATE.sports.days.find(function(x){return x.id===id;});
        d.lastDone = new Date().toLocaleDateString('he-IL', {day:'numeric', month:'numeric', year:'numeric'});
        if(!STATE.sports.workoutLog) STATE.sports.workoutLog = [];
        STATE.sports.workoutLog.push({id:'wl_'+Date.now()+'_'+Math.floor(Math.random()*1000), dayId:d.id, dayName:d.name, date:d.lastDone});
        scheduleSave();
      });
    });
    document.querySelectorAll('[data-action="addrun"]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var dateInp = document.querySelector('input[name="rundate"]');
        var kmInp = document.querySelector('input[name="runkm"]');
        var minInp = document.querySelector('input[name="runmin"]');
        var kmVal = parseFloat(kmInp.value);
        var minVal = parseFloat(minInp.value);
        if(!kmVal || !minVal){ return; }
        var dateStr;
        if(dateInp.value){
          var parts = dateInp.value.split('-'); // yyyy-mm-dd
          dateStr = parseInt(parts[2],10)+'.'+parseInt(parts[1],10)+'.'+parts[0];
        } else {
          dateStr = new Date().toLocaleDateString('he-IL', {day:'numeric', month:'numeric', year:'numeric'});
        }
        if(!STATE.sports.runs) STATE.sports.runs = [];
        STATE.sports.runs.push({id:'run_'+Date.now()+'_'+Math.floor(Math.random()*1000), date:dateStr, km:kmVal, minutes:minVal});
        scheduleSave();
      });
    });
    document.querySelectorAll('[data-action="delrun"]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var id = btn.getAttribute('data-run');
        STATE.sports.runs = (STATE.sports.runs||[]).filter(function(r){return r.id!==id;});
        scheduleSave();
      });
    });
    document.querySelectorAll('[data-action="addwl"]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var daySel = document.querySelector('select[name="wlday"]');
        var dateInp = document.querySelector('input[name="wldate"]');
        if(!daySel) return;
        var dayId = daySel.value;
        var dateStr;
        if(dateInp && dateInp.value){
          var parts = dateInp.value.split('-'); // yyyy-mm-dd
          dateStr = parseInt(parts[2],10)+'.'+parseInt(parts[1],10)+'.'+parts[0];
        } else {
          dateStr = new Date().toLocaleDateString('he-IL', {day:'numeric', month:'numeric', year:'numeric'});
        }
        addWorkoutLogEntry(dayId, dateStr);
      });
    });
    document.querySelectorAll('[data-action="delwl"]').forEach(function(btn){
      btn.addEventListener('click', function(){
        deleteWorkoutLogEntry(btn.getAttribute('data-wl'));
      });
    });
    document.querySelectorAll('.edit-w-btn[data-action="editwl"]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var id = btn.getAttribute('data-wl');
        var w = (STATE.sports.workoutLog||[]).find(function(x){return x.id===id;});
        if(!w) return;
        var cell = document.querySelector('[data-wldatecell="'+id+'"]');
        if(!cell) return;
        var dt = parseHeDate(w.date);
        var iso = dt
          ? (dt.getFullYear()+'-'+((dt.getMonth()+1)<10?'0':'')+(dt.getMonth()+1)+'-'+(dt.getDate()<10?'0':'')+dt.getDate())
          : todayIsoDate();
        cell.innerHTML = '<span class="w-edit-row"><input type="date" value="'+iso+'" data-wldateinput /><button type="button" data-wlsave>שמור</button></span>';
        var inp = cell.querySelector('[data-wldateinput]');
        var saveBtn = cell.querySelector('[data-wlsave]');
        var commit = function(){
          var v = inp.value;
          if(v){
            var parts = v.split('-');
            var dateStr = parseInt(parts[2],10)+'.'+parseInt(parts[1],10)+'.'+parts[0];
            updateWorkoutLogDate(id, dateStr);
          } else {
            render();
          }
        };
        saveBtn.addEventListener('click', commit);
        inp.addEventListener('keydown', function(e){
          if(e.key==='Enter'){ commit(); }
          if(e.key==='Escape'){ render(); }
        });
      });
    });
    (STATE.sports.days||[]).forEach(function(d){
      var body = document.getElementById('ex-body-'+d.id);
      initDragReorder(body, 'tr', '.ex-drag-handle', function(list){
        d.exercises = list.map(function(tr){ return d.exercises[parseInt(tr.getAttribute('data-exi'),10)]; });
        scheduleSave();
      });
    });
    document.querySelectorAll('[data-action="delday"]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var id = btn.getAttribute('data-day');
        var d = STATE.sports.days.find(function(x){return x.id===id;});
        if(!d) return;
        var n = (d.exercises||[]).length;
        if(!window.confirm('למחוק את "'+d.name+'"'+(n?' ואת '+n+' התרגילים שבו':'')+'?')) return;
        deleteWorkoutDay(id);
      });
    });
    var addDayBtn = document.querySelector('[data-action="addday"]');
    if(addDayBtn){
      var dayInp = addDayBtn.closest('.add-ex-panel').querySelector('.add-day-name-input');
      var doAddDay = function(){ var v = dayInp.value.trim(); if(v) addWorkoutDay(v); };
      addDayBtn.addEventListener('click', doAddDay);
      dayInp.addEventListener('keydown', function(e){ if(e.key==='Enter'){ doAddDay(); } });
    }
    document.querySelectorAll('[data-action="delex"]').forEach(function(btn){
      btn.addEventListener('click', function(){
        deleteExercise(btn.getAttribute('data-day'), parseInt(btn.getAttribute('data-ex'),10));
      });
    });
    document.querySelectorAll('[data-action="addex"]').forEach(function(btn){
      var panel = btn.closest('.add-ex-panel');
      var nameInp = panel.querySelector('.add-ex-name-input');
      var srInp = panel.querySelector('.add-ex-sr-input');
      var doAddEx = function(){
        var name = nameInp.value.trim();
        var sr = srInp.value.trim();
        if(!name) return;
        addExercise(btn.getAttribute('data-day'), name, sr);
      };
      btn.addEventListener('click', doAddEx);
      [nameInp, srInp].forEach(function(inp){
        inp.addEventListener('keydown', function(e){ if(e.key==='Enter'){ doAddEx(); } });
      });
    });
    document.querySelectorAll('.edit-w-btn[data-action="editw"]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var dayId = btn.getAttribute('data-day');
        var exi = parseInt(btn.getAttribute('data-ex'),10);
        var d = STATE.sports.days.find(function(x){return x.id===dayId;});
        var ex = d.exercises[exi];
        var cell = document.querySelector('[data-wcell="'+dayId+'|'+exi+'"]');
        cell.innerHTML = '<div class="w-edit-row"><input type="number" step="0.5" value="'+(ex.lastWeight!=null?ex.lastWeight:'')+'" data-winput /><button data-wsave>שמור</button></div>';
        cell.querySelector('[data-wsave]').addEventListener('click', function(){
          var val = parseFloat(cell.querySelector('[data-winput]').value);
          if(!isNaN(val)){
            ex.lastWeight = val;
            ex.lastDate = new Date().toLocaleDateString('he-IL', {day:'numeric', month:'numeric', year:'numeric'});
          }
          scheduleSave();
        });
        cell.querySelector('[data-winput]').addEventListener('keydown', function(e){
          if(e.key==='Enter'){ cell.querySelector('[data-wsave]').click(); }
        });
      });
    });
    document.querySelectorAll('[data-action="addleisure"]').forEach(function(btn){
      var panel = btn.closest('.add-task-panel');
      var inp = panel.querySelector('input[name="txt"]');
      var noteInp = panel.querySelector('input[name="note"]');
      var section = btn.getAttribute('data-section');
      var autoFill = btn.getAttribute('data-autofill') === '1';
      var doAdd = function(){
        var v = inp.value.trim();
        if(!v) return;
        var noteVal = noteInp ? noteInp.value.trim() : '';
        if(!STATE.leisure) STATE.leisure = {books:[],movies:[],travel:[],learning:[]};
        if(!STATE.leisure[section]) STATE.leisure[section] = [];
        var item = {id:'lz_'+Date.now()+'_'+Math.floor(Math.random()*1000), text:v};
        if(noteVal){
          item.note = noteVal;
        } else if(noteInp && autoFill){
          // Author left blank — Claude fills it in automatically once this saves.
          // (Only for sections like books that opted into auto-fill; a section
          // like learning topics just leaves the note empty until typed in.)
          item.authorPending = true;
        }
        STATE.leisure[section].push(item);
        scheduleSave();
        if(item.authorPending){ lookupBookAuthor(section, item.id); }
      };
      btn.addEventListener('click', doAdd);
      inp.addEventListener('keydown', function(e){ if(e.key==='Enter'){ doAdd(); } });
      if(noteInp){
        noteInp.addEventListener('keydown', function(e){ if(e.key==='Enter'){ doAdd(); } });
      }
    });
    document.querySelectorAll('[data-action="delleisure"]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var section = btn.getAttribute('data-section');
        var id = btn.getAttribute('data-item');
        if(STATE.leisure && STATE.leisure[section]){
          STATE.leisure[section] = STATE.leisure[section].filter(function(x){return x.id!==id;});
          scheduleSave();
        }
      });
    });
    document.querySelectorAll('.tamar-btn[data-action="toggletamar"]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var section = btn.getAttribute('data-section');
        var id = btn.getAttribute('data-item');
        var list = (STATE.leisure && STATE.leisure[section]) || [];
        var it = list.find(function(x){return x.id===id;});
        if(!it) return;
        it.tamarLikes = !it.tamarLikes;
        scheduleSave();
      });
    });
    ['books','movies','travel','learning','cooking'].forEach(function(section){
      var ul = document.getElementById('leisure-list-'+section);
      if(!ul) return;
      initDragReorder(ul, 'li', '.task-drag-handle', function(list){
        var ids = list.map(function(li){ return li.getAttribute('data-task'); });
        var byId = {};
        (STATE.leisure[section]||[]).forEach(function(it){ byId[it.id]=it; });
        STATE.leisure[section] = ids.map(function(id){ return byId[id]; }).filter(Boolean);
        scheduleSave();
      });
    });
    var leisureSectionsEl = document.getElementById('leisure-sections');
    if(leisureSectionsEl){
      initDragReorder(leisureSectionsEl, '.leisure-section-group', '.leisure-sec-drag', function(list){
        STATE.leisureSectionOrder = list.map(function(el){ return el.getAttribute('data-section'); });
        scheduleSave();
      });
    }
  }

  function documentHTML(state){
    var fontLink = document.getElementById('app-font-link').outerHTML;
    var styleTag = document.getElementById('app-style').outerHTML;
    var scriptTag = document.getElementById('app-script').outerHTML;
    var stateScript = '<script id="state-data" type="application/json">'+JSON.stringify(state)+'<\/script>';
    return '<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">'
         + '<meta name="viewport" content="width=device-width, initial-scale=1">'
         + '<title>הדשבורד של שחר</title>'
         + fontLink + styleTag
         + '</head><body><div id="app"></div>' + stateScript + scriptTag + '</body></html>';
  }

  var isPublishing = false;
  var needsSave = false;

  function setSavingUI(on){ return; /* saving is local and instant now */
    var app = document.getElementById('app');
    if(app){ app.classList.toggle('saving', on); }
    var toast = document.getElementById('save-toast');
    if(on){
      if(!toast){
        toast = document.createElement('div');
        toast.id = 'save-toast';
        toast.className = 'save-toast';
        toast.textContent = 'שומר שינויים…';
        document.body.appendChild(toast);
      }
    } else if(toast){
      toast.remove();
    }
  }

  function scheduleSave(){
    // Remember which page we're on (in this browser tab only) so a
    // reload-after-publish restores it instead of landing on the home page.
    // Deliberately not written into STATE — that's shared/published, and
    // opening the dashboard link should always start at the home page.
    try{ sessionStorage.setItem('lastRoute', currentRoute()); }catch(e){}
    // Render immediately (optimistic), then publish right away — no artificial
    // delay. The UI locks (pointer-events off) while a publish is in flight so
    // a second click can never land mid-publish and get lost when the page
    // auto-reloads to the newly published version.
    render();
    needsSave = true;
    if(!isPublishing){ flushSave(); }
  }

  async function flushSave(){
    isPublishing = true;
    setSavingUI(true);
    while(needsSave){
      needsSave = false;
      try{
        window.__DASH__.save(STATE);
      }catch(err){
        // conflict or publish error: local view already reflects the change;
        // if another change was queued meanwhile (needsSave) the loop retries.
      }
    }
    isPublishing = false;
    setSavingUI(false);
  }

  // One-time migration: seeds the new "leisure" (פנאי) section the first time
  // this dashboard loads after the feature shipped, so it isn't just an empty
  // page. Books are prefilled from what Shahar has actually said he wants to
  // read; movies/travel start empty since he hasn't named specific ones yet.
  // Runs only once — once STATE.leisure exists, this is a no-op forever.
  function ensureLeisureDefaults(){
    if(STATE.leisure) return false;
    STATE.leisure = {
      books: [
        {id:'lz_book_1', text:'Outliers', note:'מלקולם גלדוול'},
        {id:'lz_book_2', text:'Grit', note:'אנג׳לה דאקוורת׳'},
        {id:'lz_book_3', text:'ספר (טרם נבחר איזה)', note:'דויד גרוסמן'},
        {id:'lz_book_4', text:'ספר (טרם נבחר איזה)', note:'אשכול נבו'}
      ],
      movies: [],
      travel: []
    };
    return true;
  }

  // One-time migration: adds the "נושאים ללמידה" (learning topics) list the
  // first time this dashboard loads after that feature shipped. Prefilled
  // with the topics Shahar named when asking for this — each can carry a
  // free-text note, same as the other leisure sections. Runs only once —
  // once STATE.leisure.learning exists (even as an empty array), it's a
  // no-op forever, so items he deletes later never come back.
  function ensureLearningDefaults(){
    if(!STATE.leisure) STATE.leisure = {books:[],movies:[],travel:[],learning:[]};
    if(STATE.leisure.learning) return false;
    STATE.leisure.learning = [
      {id:'lz_learn_1', text:'יצירת סוכני AI (AI agents)'},
      {id:'lz_learn_2', text:'יצירת אפליקציה בעזרת AI'},
      {id:'lz_learn_3', text:'השקעות עם AI'}
    ];
    return true;
  }

  window.__DASH__.onRemoteState(function(next){ STATE = next; render(); });
  window.addEventListener('hashchange', function(){ render(); window.scrollTo(0,0); });
  // One-time cleanup on load: drop workout log entries older than the 14-day
  // graph window. Only triggers a save/republish when something was actually
  // pruned, so a normal load with nothing stale doesn't cause an extra publish.
  var neededMigrationSave = false;
  if(pruneOldWorkoutLog()) neededMigrationSave = true;
  if(ensureLeisureDefaults()) neededMigrationSave = true;
  if(ensureLearningDefaults()) neededMigrationSave = true;
  if(ensureDietDefaults()) neededMigrationSave = true;
  if(neededMigrationSave){ scheduleSave(); } else { render(); }
})();
