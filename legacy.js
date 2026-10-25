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
      html += fbTile('fb-span6', 'נדל״ן · '+esc((re.address||'').split(',').slice(0,2).join(',').replace(/\s*\(.*$/,'')),
          '<div class="fb-re-top"><div><div class="fb-kpi-sub">הון עצמי משוער</div><div class="fb-mid">'+fmtK(reEquity)+'</div></div>'
        + '<div><div class="fb-kpi-sub">שווי היום</div><div class="fb-mid fb-dim"><span dir="ltr">'+fmtK(lo)+' – '+fmtK(hi)+'</span></div></div>'
        + '<div><div class="fb-kpi-sub">אחרי פינוי-בינוי</div><div class="fb-mid fb-dim"><span dir="ltr">'+fmtK(re.estLow||0)+' – '+fmtK(re.estHigh||0)+'</span></div></div></div>'
        + '<div class="fb-re-bar"><i class="m" style="width:'+(mort/scale*100).toFixed(1)+'%"></i><i class="e" style="width:'+(Math.max(0,reMid-mort)/scale*100).toFixed(1)+'%"></i></div>'
        + '<div class="fb-split-legend fb-inline"><div><span><i style="background:#5b5e94"></i>משכנתא</span>'+fmtK(mort)+'</div><div><span><i style="background:'+FB.teal+'"></i>הון עצמי</span>'+fmtK(reEquity)+'</div><div><span><i style="background:'+FB.yellow+'"></i>הושקע עד היום</span>'+fmtK(reSpent)+'</div></div>'
        + fbDetails([['מפרט', re.spec], ['נרכשה', (re.purchaseDate||'')+' · ₪'+(re.purchasePrice||0).toLocaleString('en-US')], ['משכנתא נכון ל', re.mortgageAsOf], ['שכ״ד / משכנתא לחודש', '₪'+(re.monthlyRent||0).toLocaleString('en-US')+' / ₪'+(re.monthlyMortgage||0).toLocaleString('en-US')], ['תזרים מצטבר', reMonths+' חודשים · ₪'+(reMonths*Math.abs(re.monthlyNet||0)).toLocaleString('en-US')], ['הוצאות חד-פעמיות', '₪'+(reSpent - reMonths*Math.abs(re.monthlyNet||0)).toLocaleString('en-US')], ['הערכת שווי נכון ל', re.currentEstAsOf], ['הערת הסוכן', re.currentEstNote], ['הערכה אחרי פינוי-בינוי', re.estNote]]));
    }
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
      html += fbTile('fb-span3', 'ביטוחים',
          fbDonut(segs, '<span dir="ltr">₪'+Math.round(ins.totalMonthly||0)+'</span>', 'לחודש')
        + '<div class="fb-split-legend">'+segs.map(function(s){ return '<div><span><i style="background:'+s.color+'"></i>'+esc(s.label)+'</span><span dir="ltr">₪'+Math.round(s.v)+'</span></div>'; }).join('')+'</div>'
        + fbDetails((ins.policies||[]).map(function(p){ return [String(p.company||'').replace(' חברה לביטוח','')+' · '+(p.title||''), '₪'+(Math.round((p.monthlyEquivalent||0)*10)/10)+' · '+(p.policyNumber||'')]; }).concat([['מקור', ins.source]]), (ins.policies||[]).length+' פוליסות'));
    }
    if(f.loan){
      html += fbTile('fb-span3 fb-kpi', 'הלוואות',
          '<div class="fb-kpi-n fb-big2">'+fmtK(loanV)+'</div><div class="fb-kpi-sub">'+esc(f.loan.lender||'')+'</div><div class="fb-kpi-sub">'+esc(f.loan.terms||'')+'</div>');
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
    html += '<div class="page-head"><h1>ספורט ואימונים</h1><div class="sub help">3 ימי אימון · לכל תרגיל המשקל האחרון שנרשם וסרטון הדרכה · לחיצה על שם התרגיל או על הסטים/חזרות עורכת אותם במקום · ✕ מחיקת תרגיל · גררו את הידית (⠿) כדי לשנות את סדר התרגילים · בתחתית כל יום ניתן להוסיף תרגיל חדש · למטה: יומן אימונים (מזין את הגרף — ניתן להוסיף/לערוך תאריך/למחוק רשומה אם יש טעות) ומעקב ריצות</div></div>';
    html += workoutSummaryHTML(state);
    html += '<div class="panel"><div class="panel-body">';
    s.days.forEach(function(d){
      html += '<div class="day-card"><div class="day-head"><div><h3>'+esc(d.name)+'</h3><span class="last-done">'+(d.lastDone?'בוצע לאחרונה: '+d.lastDone:'טרם נרשם')+'</span></div>';
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
    html += '</div></div>';
    html += workoutLogPanelHTML(state);
    html += runsPanelHTML(state);
    return html;
  }

  /* ---------- SPORTS: WORKOUT SUMMARY + RUNS ---------- */
  var DAY_COLORS = {upperA:'var(--cat-blue)', lowerB:'var(--cat-olive)', upperC:'var(--cat-violet)'};
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
        var color = DAY_COLORS[w.dayId] || 'var(--accent)';
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
    var items = state.sports.days.map(function(d){ return {label:d.name, color: DAY_COLORS[d.id]||'var(--accent)'}; });
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

  /* ---------- ROUTER ---------- */
  var routes = {
    '': homeHTML,
    '#': homeHTML,
    '#home': homeHTML,
    '#tasks': tasksPageHTML,
    '#finance': financePageHTML,
    '#debts': debtsPageHTML,
    '#sports': sportsPageHTML,
    '#leisure': leisurePageHTML
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
  if(neededMigrationSave){ scheduleSave(); } else { render(); }
})();
