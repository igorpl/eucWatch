//Veteran  pedal settings for the wheels that dropped the soft/medium/hard modes
//HARD is Leaperkim's pedal softness, ASSIST its acceleration and deceleration assist and
//COMP its accelerometer reduction. All three are percentages, see VeteranProtocol.md.
//The wheel reports them back in sub packet 8, and 0x80 there means it does not have the
//setting, which is shown as --.

face[0] = {
	offms: (ew.def.off[face.appCurr])?ew.def.off[face.appCurr]:5000,
	g:w.gfx,
	//name, the euc.dash.opt.ride key, and the command
	itm: [["HARD","hard","pedHard"],["ASSIST","asst","pedAsst"],["COMP","comp","pedComp"]],
	init: function(){
		this.g.setColor(0,0);
		this.g.fillRect(0,196,239,239);
		this.g.setColor(1,15);
		this.g.setFont("Vector",20);
		this.g.drawString("PEDAL SETTINGS",120-(this.g.stringWidth("PEDAL SETTINGS")/2),214);
		this.g.flip();
		this.setE=0;
		this.was=[-1,-1,-1];
		this.run=true;
	},
	show : function(){
		if (euc.state!=="READY") {face.go(ew.is.dash[ew.def.dash.face],0);return;}
		if (!this.run) return;
		if (!this.setE) for (let i=0;i<3;i++) {
			let v=euc.dash.opt.ride[this.itm[i][1]];
			if (this.was[i]!=v) {
				this.was[i]=v;
				this.btn(this.sup(v),this.itm[i][0],20,60,this.y(i)+22,12,1,0,this.y(i),239,this.y(i)+62,this.disp(v),30,185,this.y(i)+18);
			}
		}
		this.tid=setTimeout(function(t,o){
		  t.tid=-1;
		  t.show();
		},200,this);
	},
	y: function(i){ return i*65; },
	//0x80 is the wheel saying it has no such setting, and it never arrives at all on a
	//wheel that does not send sub packet 8
	sup: function(v){ return (v!==undefined && v!=128)?1:0; },
	disp: function(v){ return this.sup(v)?v.toString(10)+"%":"--"; },
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
	ntfy: function(txt,size,clr){
		this.g.setColor(0,clr);
		this.g.fillRect(0,198,239,239);
		this.g.setColor(1,15);
		this.g.setFont("Vector",size);
		this.g.drawString(txt,120-(this.g.stringWidth(txt)/2),214);
		this.g.flip();
		if (this.ntid) clearTimeout(this.ntid);
		this.ntid=setTimeout(function(t){
			t.ntid=0;
			if (!t.setE){
				t.g.setColor(0,0);
				t.g.fillRect(0,198,239,239);
				t.g.setColor(1,15);
				t.g.setFont("Vector",20);
				t.g.drawString("PEDAL SETTINGS",120-(t.g.stringWidth("PEDAL SETTINGS")/2),214);
				t.g.flip();
			}
		},1500,this);
	},
	set: function(i){
		this.setE=i+1;
		//the app uses a 1% seek bar, 5% is enough on a watch and matches the alert screen
		this.setV=Math.round((euc.dash.opt.ride[this.itm[i][1]]||0)/5)*5;
		if (100<this.setV) this.setV=0;
		this.g.setColor(0,1);
		this.g.fillRect(0,0,239,195);
		this.g.setColor(1,15);
		this.g.setFont("Vector",20);
		this.g.drawString(this.itm[i][0]+" (%)",120-(this.g.stringWidth(this.itm[i][0]+" (%)")/2),10);
		this.g.drawString("<",5,90); this.g.drawString(">",230,90);
		this.g.flip();
		this.val();
	},
	//the box spans the full width between the arrows and three digits are drawn smaller,
	//otherwise the sides of 100 survive when it drops back to two digits
	val: function(){
		let t=this.setV.toString(10);
		this.btn(0,t,(t.length<3)?100:75,126,60,12,1,20,40,225,160);
	},
	send: function(){
		let i=this.setE-1;
		euc.wri(this.itm[i][2],this.setV);
		euc.dash.opt.ride[this.itm[i][1]]=this.setV;
		this.setE=0;
		this.g.clear();
		this.init();
		//these frames are longer than anything else the watch writes, so say so if the
		//link would not take it rather than leaving a value that never reached the wheel
		if (euc.temp.wErr) setTimeout(function(t){t.ntfy("WRITE REJECTED",19,13);},300,this);
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
			if (195<y) {buzzer.nav(40);break;}
			let i=(y<65)?0:(y<130)?1:2;
			if (!face[0].sup(euc.dash.opt.ride[face[0].itm[i][1]])) {
				face[0].ntfy("NOT ON THIS WHEEL",19,13);
				buzzer.nav(40);
				break;
			}
			face[0].set(i);
			buzzer.nav([30,50,30]);
		}else {
			if (120<=x&&y<=195) { if (face[0].setV<100) face[0].setV=face[0].setV+5; }
			else if (y<=195) { if (0<face[0].setV) face[0].setV=face[0].setV-5; }
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
		face.go("dashVeteran",0);
		return;
	case 12: //long press event
		buzzer.nav(40);
		this.timeout();
		break;
	}
};
