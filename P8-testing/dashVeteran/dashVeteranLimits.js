//Veteran  set wheel alerts
//ALERT is the wheel's speed alarm, offset 24, and LIMIT its speed limit, offset 26.
//They are separate settings in separate command blocks, see VeteranProtocol.md.

face[0] = {
	offms: (ew.def.off[face.appCurr])?ew.def.off[face.appCurr]:5000,
	g:w.gfx,
	init: function(){
		this.g.setColor(0,0);
		this.g.fillRect(0,196,239,239);
		this.g.setColor(1,15);
		this.g.setFont("Vector",20);
		this.g.drawString("WHEEL ALERTS",120-(this.g.stringWidth("WHEEL ALERTS")/2),214);
		this.g.flip();
		if (!face.appPrev.startsWith("dashSet")){
			this.g.setColor(0,0);
			this.g.drawLine (0,98,239,98);
			this.g.drawLine (0,99,239,99);
			this.g.flip();
		}
		this.setE=0;
		this.alr=-1;
		this.lim=-1;
		this.run=true;
	},
	show : function(){
		if (euc.state!=="READY") {face.go(ew.is.dash[ew.def.dash.face],0);return;}
		if (!this.run) return;
		if (!this.setE) {
			if (this.alr!=euc.dash.alrt.spd.alrm){
				this.alr=euc.dash.alrt.spd.alrm;
				this.btn(1,"ALERT",20,120,20,12,1,0,0,239,97,this.disp(this.alr),30,120,50);
			}
			if (this.lim!=euc.dash.alrt.spd.max){
				this.lim=euc.dash.alrt.spd.max;
				this.btn(1,"LIMIT",20,120,120,12,1,0,100,239,195,this.disp(this.lim),30,120,150);
			}
		}
		this.tid=setTimeout(function(t,o){
		  t.tid=-1;
		  t.show();
		},200,this);
	},
	//the wheel's own menu steps in 5 km/h, so match it rather than the app's 1 km/h, and
	//end on the same 200 rung the wheel offers for both settings. The Leaperkim app caps
	//the limit at 120, but the wheel's own menu goes to 200 and reports it back, so it is
	//offered here too.
	lad: function(){
		let l=[];
		for (let s=10;s<=100;s+=5) l.push(s);
		l.push(200);
		return l;
	},
	disp: function(v){
		return Math.round(v*euc.dash.opt.unit.fact.spd*((ew.def.dash.mph)?0.625:1)).toString(10);
	},
	btn: function(bt,txt1,size1,x1,y1,clr1,clr0,rx1,ry1,rx2,ry2,txt2,size2,x2,y2){
		this.g.setColor(0,(bt)?clr1:clr0);
		this.g.fillRect(rx1,ry1,rx2,ry2);
		this.g.setColor(1,15);
		this.g.setFont("Vector",size1);
		this.g.drawString(txt1,x1-(this.g.stringWidth(txt1)/2),y1);
		if (txt2){this.g.setFont("Vector",size2);
		this.g.drawString(txt2,x2-(this.g.stringWidth(txt2)/2),y2);}
		this.g.flip();
	},
	ntfy: function(txt1,txt0,size,clr,bt){
		this.g.setColor(0,clr);
		this.g.fillRect(0,198,239,239);
		this.g.setColor(1,15);
		this.g.setFont("Vector",size);
		this.g.drawString((bt)?txt1:txt0,120-(this.g.stringWidth((bt)?txt1:txt0)/2),214);
		this.g.flip();
		if (this.ntid) clearTimeout(this.ntid);
		this.ntid=setTimeout(function(t){
			t.ntid=0;
			if (!t.setE){
				t.g.setColor(0,0);
				t.g.fillRect(0,198,239,239);
				t.g.setColor(1,15);
				t.g.setFont("Vector",20);
				t.g.drawString("WHEEL ALERTS",120-(t.g.stringWidth("WHEEL ALERTS")/2),214);
				t.g.flip();
			}
		},1000,this);
	},
	set: function(a,v,txt){
		this.setE=a?1:2;
		this.setL=this.lad();
		//snap onto the nearest rung of the ladder, the wheel may hold a value between them
		this.setI=0;
		for (let i=0;i<this.setL.length;i++) if (Math.abs(this.setL[i]-v)<Math.abs(this.setL[this.setI]-v)) this.setI=i;
		this.g.setColor(0,1);
		this.g.fillRect(0,0,239,195);
		this.g.setColor(1,15);
		this.g.setFont("Vector",20);
		this.g.drawString(txt,120-(this.g.stringWidth(txt)/2),10);
		this.g.drawString("<",5,90); this.g.drawString(">",230,90);
		this.g.flip();
		this.val();
	},
	//Anything drawn outside the box is not cleared on the next pass, so the sides of a
	//three digit number survived when it shrank back to two. The box now runs the full
	//width between the < and >, and three digits are drawn smaller so they cannot spill.
	val: function(){
		let t=this.disp(this.setL[this.setI]);
		this.btn(0,t,(t.length<3)?100:75,126,60,12,1,20,40,225,160);
	},
	//sends the pending value and drops back to the two button page
	send: function(){
		let v=this.setL[this.setI];
		if (this.setE==1) {euc.wri("alrtSpd",v);euc.dash.alrt.spd.alrm=v;}
		else {euc.wri("limtSpd",v);euc.dash.alrt.spd.max=v;}
		this.setE=0;
		this.g.clear();
		this.init();
	},
	tid:-1,
	run:false,
	clear : function(){
		this.run=false;
		if (this.tid>=0) clearTimeout(this.tid);this.tid=-1;
		if (this.ntid) clearTimeout(this.ntid);this.ntid=0;
		return true;
	},
	off: function(){
		this.g.off();
		this.clear();
	}
};
//loop face
face[1] = {
	offms:1000,
	init: function(){
		return true;
	},
	show : function(){
		face.go(ew.is.dash[ew.def.dash.face],0);
		return;
	},
	clear: function(){
		return true;
	},
};
//touch
touchHandler[0]=function(e,x,y){
	switch (e) {
	case 5: //tap event
		if (!face[0].setE){
			if (y<100) {
				face[0].set(1,euc.dash.alrt.spd.alrm,"ALERT ("+(ew.def.dash.mph?"MPH)":"KPH)"));
				buzzer.nav([30,50,30]);
			}else if (y<=195) {
				face[0].set(0,euc.dash.alrt.spd.max,"LIMIT ("+(ew.def.dash.mph?"MPH)":"KPH)"));
				buzzer.nav([30,50,30]);
			}else buzzer.nav(40);
		}else {
			if (120<=x&&y<=195) { if (face[0].setI<face[0].setL.length-1) face[0].setI++; }
			else if (y<=195) { if (0<face[0].setI) face[0].setI--; }
			buzzer.nav([30,50,30]);
			face[0].val();
		}
		this.timeout();
		break;
	case 1: //slide down event
		if (face[0].setE) {face[0].send();return;}
		face.go(ew.is.dash[ew.def.dash.face],0);
		return;
	case 2: //slide up event
		if ( 200<=y && x<=50 ) { //toggles full/current brightness on a left down corner swipe up.
			if (w.gfx.bri.lv!==7) {this.bri=w.gfx.bri.lv;w.gfx.bri.set(7);}
			else w.gfx.bri.set(this.bri);
			buzzer.nav([30,50,30]);
		}else if (Boolean(require("Storage").read("settings"))) {face.go("settings",0);return;}
		this.timeout();
		break;
	case 3: //slide left event
		buzzer.nav(40);
		this.timeout();
		break;
	case 4: //slide right event (back action)
		if (face[0].setE) {face[0].send();return;}
		face.go("dashVeteranOptions",0);
		return;
	case 12: //long press event
		buzzer.nav(40);
		this.timeout();
		break;
	}
};
