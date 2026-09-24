//clock Debug. opened with a hold on MAIN OPTIONS, closed with a swipe or a hold, a tap
//resets the peaks. It shows where the watch spends its time while a wheel is connected:
//the chunk rate and the time spent in the notification handler (Begode only, the one
//driver whose handler can be wrapped without copying it), how late a 50ms timer fires,
//which is how busy the whole watch is, and the settings that multiply ble work.
//For the link itself: bytes per chunk (a phone always saw 20 from a Begode, a module that
//sends less makes more events for the same data), chunks with no frame bytes, how often
//the link dropped out of READY, and the interval asked on this connection next to the one
//the slot is set to (DASH OPTIONS, LINK).
//The screen itself costs a redraw a second, that time is left out of the lag figures.
face[0] = {
	offms: 120000,
	g: w.gfx,
	init: function() {
		global.dbgS = {
			t0: getTime(), last: getTime(), skip: 1, cnt: 0,
			n: 0, hT: 0, hM: 0, ty: new Uint16Array(9), b: 0, bm: 99, rc: 0, st: global.euc ? euc.state : 0,
			lagT: 0, lagM: 0, lagP: 0, bz: 0,
			mf: 0, mt: 0, mn: 1e9, fl: [], tmp: 0
		};
		let s = dbgS;
		//every 50ms. how late it fires is time something else held the cpu
		s.li = setInterval(function() {
			let s = dbgS, now = getTime(), late = now - s.last - 0.05;
			s.last = now;
			if (s.skip) { s.skip = 0; return; }
			if (0 < late) { s.lagT += late; if (s.lagM < late) s.lagM = late; }
			//a drop is READY turning into anything else. sampled here, not on the redraw,
			//so a reconnect quicker than a second is still counted
			let st = global.euc ? euc.state : 0;
			if (st != s.st) { if (s.st == "READY") s.rc++; s.st = st; }
		}, 50);
		//count the alert buzzes, a wheel that keeps an alarm up buzzes on every frame
		s.bs = buzzer.sys; s.be = buzzer.euc;
		buzzer.sys = function(a) { dbgS.bz++; return dbgS.bs(a); };
		buzzer.euc = function(a) { dbgS.bz++; return dbgS.be(a); };
		this.hook();
		this.g.setColor(0, 0);
		this.g.fillRect(0, 0, 239, 239);
		this.g.flip();
		this.run = true;
	},
	show: function() {
		if (!this.run) return;
		this.draw();
		this.tid = setTimeout(function(t) {
			t.tid = -1;
			t.show();
		}, 1000, this);
	},
	//wrap the Begode handler. euc.temp.read is the listener, euc.temp.main holds the code,
	//so read can be pointed at a timing wrapper and back without losing anything. euc.temp
	//is rebuilt per session, so a new one gets hooked on the next redraw.
	hook: function() {
		let s = dbgS;
		if (!global.euc || !euc.temp || !euc.temp.main || !euc.temp.buf || s.tmp === euc.temp) return;
		s.tmp = euc.temp;
		s.type = euc.temp.type;
		euc.temp.type = function() {
			let t = euc.temp.buf[18];
			dbgS.ty[t < 8 ? t : 8]++;
			dbgS.type();
		};
		euc.temp.read.replaceWith(function(e) {
			let a = getTime();
			(euc.temp.ext ? euc.temp.extd : euc.temp.main)(e);
			a = getTime() - a;
			let s = dbgS, l = e.target.value.buffer.length;
			s.n++;
			s.hT += a;
			if (s.hM < a) s.hM = a;
			s.b += l;
			if (l < s.bm) s.bm = l;
		});
	},
	unhook: function() {
		let s = global.dbgS;
		if (!s) return;
		if (s.li) clearInterval(s.li);
		if (s.tmp && global.euc && euc.temp === s.tmp) {
			euc.temp.type = s.type;
			euc.temp.read.replaceWith(euc.temp.ext ? euc.temp.extd : euc.temp.main);
		}
		buzzer.sys = s.bs;
		buzzer.euc = s.be;
		delete global.dbgS;
	},
	row: function(i, l, v, c) {
		let g = this.g, y = i * 20;
		g.setColor(0, 0);
		g.fillRect(0, y, 239, y + 19);
		g.setColor(1, 11);
		g.drawString(l, 2, y + 2);
		g.setColor(1, c || 15);
		g.drawString(v, 10 + g.stringWidth(l), y + 2);
	},
	draw: function() {
		let s = dbgS, now = getTime(), dt = now - s.t0;
		if (dt <= 0) dt = 1;
		this.hook();
		s.cnt++;
		//process.memory() runs a gc pass, every other second is enough
		if (s.cnt & 1) {
			let m = process.memory();
			s.mf = m.free; s.mt = m.total;
			if (m.free < s.mn) s.mn = m.free;
		}
		//reading the flags clears them, so keep every one seen until a tap
		E.getErrorFlags().forEach(function(f) { if (s.fl.indexOf(f) < 0) s.fl.push(f); });
		let tmr = 0;
		try { let tm = global["\xFF"].timers; for (let k in tm) tmr++; } catch (x) { tmr = "?"; }
		let ph = "?";
		try { ph = NRF.getSecurityStatus().connected ? 1 : 0; } catch (x) {}
		let lagMs = Math.round(s.lagM * 1000);
		if (s.lagP < lagMs) s.lagP = lagMs;
		let busy = Math.round(100 * s.lagT / dt);
		let hCpu = Math.round(100 * s.hT / dt);
		let e = global.euc, on = e && e.state != "OFF";
		let g = this.g;
		g.setFont("Vector", 17);
		this.row(0, "DBG", e ? e.state + " " + e.dash.info.get.makr + " " + (e.dash.info.get.modl || "") : "NO EUC", 14);
		if (s.tmp && on) {
			let f = 0, ty = "", nm = euc.temp.nm || 0;
			euc.temp.nm = 0;
			for (let i = 0; i < 9; i++) if (s.ty[i]) { f += s.ty[i]; ty += (i < 8 ? i : "x") + ":" + s.ty[i] + " "; }
			let bpc = s.n ? s.b / s.n : 0;
			this.row(1, "CHUNKS", (s.n / dt).toFixed(1) + "/s " + bpc.toFixed(1) + "B min " + (s.n ? s.bm : "-"), (s.n && bpc < 19) ? 14 : 0);
			this.row(2, "FRAMES", (f / dt).toFixed(1) + "/s  other " + nm, nm ? 14 : 0);
			this.row(3, "TYPES", ty || "none");
			this.row(4, "HANDLER", (s.n ? (1000 * s.hT / s.n).toFixed(2) : "0") + "ms max " + (1000 * s.hM).toFixed(1));
		} else {
			this.row(1, "CHUNKS", on ? "Begode only" : "-");
			this.row(2, "FRAMES", "-");
			this.row(3, "TYPES", "-");
			this.row(4, "HANDLER", "-");
		}
		this.row(5, "CPU", "ble " + hCpu + "%  lag " + busy + "%", (30 <= busy || 30 <= hCpu) ? 13 : 0);
		this.row(6, "LAG MS", lagMs + " peak " + s.lagP + " bz " + s.bz, 100 <= lagMs ? 13 : 0);
		this.row(7, "MEM", s.mf + "/" + s.mt + " min " + s.mn, s.mn < 300 ? 13 : 0);
		this.row(8, "FLAGS", s.fl.length ? s.fl.join(",") : "none", s.fl.length ? 13 : 0);
		//ci is asked/slot: what the driver passed to NRF.connect on this connection, "-" if
		//it never called euc.link(), which is an old driver, and what the slot is set to
		let ciA = (e && e.is.ci) || "-", ciS = (e && e.dash && e.dash.opt && e.dash.opt.ci) || 7.5;
		this.row(9, "LINK", "drops " + s.rc + " ci " + ciA + "/" + ciS + " tmr " + tmr, s.rc ? 13 : (on && ciA != ciS) ? 14 : 0);
		this.row(10, "SET", "prx " + ew.def.prxy + " bt " + ew.is.bt + " ph " + ph + " acc " + ew.def.acc, ew.is.bt == 5 ? 14 : 0);
		if (e && e.dash)
			this.row(11, "FW", (e.dash.info.get.firm || "-") + " hw " + e.dash.alrt.pwm.hw + " al " + e.is.alert + " w " + e.dash.alrt.warn.code, e.dash.alrt.warn.code ? 14 : 0);
		else this.row(11, "FW", "-");
		g.flip();
		//new window. the redraw above held the cpu, the next lag sample must not count it
		s.n = 0; s.hT = 0; s.hM = 0; s.lagT = 0; s.lagM = 0; s.bz = 0; s.b = 0; s.bm = 99;
		for (let i = 0; i < 9; i++) s.ty[i] = 0;
		s.t0 = getTime();
		s.last = s.t0;
		s.skip = 1;
	},
	//back to MAIN OPTIONS, with the page that opened it as the one a swipe there returns to
	exit: function() {
		let b = face.dbgBack;
		face.go("clockOptions", 0);
		if (b) { face.appPrev = b[0]; face.pagePrev = b[1]; delete face.dbgBack; }
	},
	tid: -1,
	run: false,
	clear: function() {
		this.run = false;
		if (this.tid >= 0) clearTimeout(this.tid);
		this.tid = -1;
		this.unhook();
		return true;
	},
	off: function() {
		this.g.off();
		this.clear();
	}
};
//screen timeout
face[1] = {
	offms: 1000,
	init: function() {
		return true;
	},
	show: function() {
		face[0].exit();
	},
	clear: function() {
		return true;
	},
	off: function() {
		return true;
	}
};
//touch
touchHandler[0] = function(e, x, y) {
	switch (e) {
	case 5: //tap resets the peaks and the flags
		buzzer.nav([30, 50, 30]);
		if (global.dbgS) { dbgS.lagP = 0; dbgS.mn = 1e9; dbgS.fl = []; dbgS.rc = 0; }
		this.timeout();
		return;
	case 1: //slide down
	case 2: //slide up
	case 3: //slide left
	case 4: //slide right
	case 12: //hold
		buzzer.nav([30, 50, 30]);
		face[0].exit();
		return;
	}
};
