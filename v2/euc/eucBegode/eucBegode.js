//Begode euc module - based on code from Freetyl3r's euc dash.
E.setFlags({ pretokenise: 1 });
euc.cmd=function(cmd, param) {
  if (cmd=='extendedPacket') {
	  euc.temp.ext=1;
	setTimeout(()=>{euc.temp.read.replaceWith(euc.temp.extd);},500);
  }else if (euc.temp.ext){
  	euc.temp.ext=0;
	  euc.temp.read.replaceWith(euc.temp.main);
  }
  switch(cmd) {
    case 'mainPacket':      return [44];
    case 'extendedPacket':  return [107];
    case 'fetchModel':      return [78];
    case 'fetchFirmware':   return [86];
    case 'fetchGreet':      return [103];
    case 'beep':            return [98];
    case 'lightsOn':        return [81];
    case 'lightsOff':       return [69];
    case 'lightsStrobe':    return [84];
    case 'alertsTwo':       return [117];
    case "alertsOneTwo":    return [111];
    case 'alertsOff':       return [105];
    case 'alertsTiltback':  return [73];
    case 'pedalSoft':       return [115];
    case 'pedalMedium':     return [102];
    case 'pedalHard':       return [104];
    case 'rollAngleLow':    return [62];
    case 'rollAngleMedium': return [61];
    case 'rollAngleHigh':   return [60];
    case 'speedKilometers': return [103];
    case 'speedMiles':      return [109];
    case 'calibrate':       return [99, 121];
    case 'startIAP':        return [33, 64];
    case 'tiltbackOff':     return [34];
    case 'tiltbackSpeed':   return [87, 89, param / 10 + 48, param % 10 + 48];
    case 'pwmLimit':        return [87, 80, param / 10 + 48, param % 10 + 48];
    case 'volume':          return [87, 66, 48 + param];
    case 'ledMode':         return [87, 77, 48 + param];
    default:                return [];
  }
};
euc.temp.faultAlarms =function(code) {
	switch(code) {
		case 0: return 'high power';
		case 1: return 'high speed 2';
		case 2: return 'high speed 1';
		case 3: return 'low voltage';
		case 4: return 'over voltage';
		case 5: return 'high temperature';
		case 6: return 'hall sensor error';
		case 7: return 'transport mode';
	}
};
//pwm, single entry point for every source
euc.temp.pwmSet=function(p){
	euc.dash.live.pwm = (p<0)?0:(100<p)?100:Math.round(p);
	if (euc.dash.trip.pwm < euc.dash.live.pwm) euc.dash.trip.pwm = euc.dash.live.pwm;
};
//full pack voltage, the point rotS is quoted at. pack is the cell count set in dash options
euc.temp.packV=function(){ return euc.dash.opt.bat.pack*4.2; };
//pack was a voltage multiplier before it became a cell count, 1.5 meant 100.8V.
//anything under 8 is one of those, no wheel runs on 8 cells.
if (euc.dash.opt.bat.pack<8) euc.dash.opt.bat.pack=Math.round(euc.dash.opt.bat.pack*16);
//older garage slots: no hw flag, no rotS, or a rotS/rotV pair from the model table.
//rotV is gone, rotS now means free spin speed at a full pack, so fold the old pair in.
if (euc.dash.alrt.pwm.hw===undefined) euc.dash.alrt.pwm.hw=0;
if (!euc.dash.alrt.pwm.pwrF) euc.dash.alrt.pwm.pwrF=0.9;
if (!euc.dash.alrt.pwm.rotS) euc.dash.alrt.pwm.rotS=50;
else if (euc.dash.alrt.pwm.rotV) {
	euc.dash.alrt.pwm.rotS=Math.round(euc.dash.alrt.pwm.rotS*euc.temp.packV()/euc.dash.alrt.pwm.rotV);
	delete euc.dash.alrt.pwm.rotV;
}
//pwm estimated from speed, software mode
euc.temp.pwmEst=function(){
	let d = (euc.dash.alrt.pwm.rotS/euc.temp.packV()) * euc.dash.live.volt * euc.dash.alrt.pwm.pwrF;
	if (0 < d) euc.temp.pwmSet(100*euc.dash.live.spd/d);
};
euc.temp.hapt=function(){
	//haptic
	if (euc.dash.alrt.pwm.hapt.en && (euc.dash.alrt.warn.code || euc.dash.alrt.pwm.hapt.hi<=euc.dash.live.pwm)){
		buzzer.sys(80);
	}else 	if (!euc.is.buzz && euc.is.alert) {
		if (!w.gfx.isOn&&(euc.dash.alrt.spd.cc||euc.dash.alrt.amp.cc||euc.dash.alrt.warn.code)) face.go(ew.is.dash[ew.def.dash.face],0);
		//else face.off(6000);
		euc.is.buzz=1;
		if (20 <= euc.is.alert) euc.is.alert = 20;
		var a = [100];
		while (5 <= euc.is.alert) {
			a.push(200,500);
			euc.is.alert = euc.is.alert - 5;
		}
		let i;
		for (i = 0; i < euc.is.alert ; i++) {
			a.push(200,150);
		}
		buzzer.euc(a);
		setTimeout(() => { euc.is.buzz = 0; }, 3000);
	}
};
//firmware banner: GW stock, JN ExtremeBull, CF Freestyl3r, BF SmirnoV.
//the two custom ones report pwm in the live frame, stock does not.
euc.temp.firm=function(id){
	if (id!=0x4757 && id!=0x4A4E && id!=0x4346 && id!=0x4246) return 0;
	euc.temp.hwPwm = (id==0x4346||id==0x4246)?1:0;
	return 1;
};
euc.temp.line="";
euc.temp.extd= function(event) {
	//if (ew.is.bt==5) 	euc.proxy.w(event.target.value.buffer);
	if (euc.dbg)  console.log("input on ext",event.target.value.buffer);
	let fragment = E.toString(event.target.value.buffer);
	let lineEnd = fragment.indexOf('\n');
	if (lineEnd == -1){
		euc.temp.line += fragment;
	}else {
		euc.temp.line += fragment.slice(0, lineEnd);
		let keys = euc.temp.line.match(/[A-z\/=]+/g);
		keys = keys.map(l => l.split('=')[0]);
		let values = euc.temp.line.match(/[-0-9]+/g);
		//get values
		let pwmIndex = keys.indexOf('PWM');
		if (pwmIndex == -1)
		  pwmIndex = keys.indexOf('pwmmmm');
		//pwm
		if (pwmIndex != -1)
		  euc.dash.live.pwm = Math.abs(values[pwmIndex] / 100);
		//tmp
		let tempIndex = keys.indexOf('Tem');
		if (tempIndex != -1)
		  euc.dash.live.tmp  = values[tempIndex] / 333.87 + 21.0; // MPU6500 format
		//spd
		let spdIndex = keys.indexOf('M/s');
		if (spdIndex != -1)
			euc.dash.live.spd = Math.abs((values[spdIndex] * 3.6)/1000);
		//volt
		let voltIndex = keys.indexOf('Voltage');
		if (voltIndex != -1){
			euc.dash.live.volt =Math.abs(values[voltIndex] / 100);
			euc.dash.live.bat=Math.round( 100*(euc.dash.live.volt*(100/euc.dash.opt.bat.pack) - euc.dash.opt.bat.low ) / (euc.dash.opt.bat.hi-euc.dash.opt.bat.low) );
		}
		//keys.forEach((key, i) => print(key+"="+values[i]));
		euc.temp.line = fragment.slice(lineEnd + 1);
	}
};
euc.temp.main=function(event){
	if (ew.is.bt==5) 	euc.proxy.w(event.target.value.buffer);
	if (euc.dbg)  console.log("input",event.target.value.buffer);
	//gather packet
	let part=JSON.parse(JSON.stringify(event.target.value.buffer));
	let startP = part.findIndex((el, idx, arr) => {return arr[idx] == 85 && arr[idx + 1] == 170;});
	let endP = part.findIndex((el, idx, arr) => {return arr[idx] == 90 && arr[idx + 1] == 90 && arr[idx + 2] == 90 && arr[idx + 3] == 90;});
	//format packet
	if (startP!=-1) {
		if (endP!=-1)
			euc.temp.type(new DataView(E.toUint8Array(euc.temp.last,part.slice(0,endP+4)).buffer));
		euc.temp.last=part.slice(startP,part.length);
	} else if (endP!=-1) {
		euc.temp.type(new DataView(E.toUint8Array(euc.temp.last,part.slice(0,endP+4)).buffer));
		euc.temp.last=[];
	} else { // model/firm
		if (event.target.value.getUint32(0) == 0x4E414D45) { //fetchModel
			console.log("model fetch responce:",event.target.value.buffer);
			euc.dash.info.get.modl =  E.toString(event.target.value.buffer).slice(5).trim();
			if (euc.dash.info.get.modl=="Barton") euc.dash.info.get.modl="RecioWheel";
			if (!ew.do.fileRead("dash","slot"+ew.do.fileRead("dash","slot")+"Model"))
				ew.do.fileWrite("dash","slot"+ew.do.fileRead("dash","slot")+"Model",euc.dash.info.get.modl);
			//no per model table: pack, empty cell and free spin speed are set in dash options
		} else if (euc.temp.firm(event.target.value.getInt16(0))) { //fetchFirmware
			euc.dash.info.get.firm = E.toString(event.target.value.buffer).slice(2);
		}
	}
};

euc.temp.type=function(data){
	if (data.byteLength == 24 && data.getInt16(0) == 0x55AA ){
		euc.is.alert=0;
		if (data.buffer[18]==0)	euc.temp.pck0(data);
		else if (data.buffer[18]==4) euc.temp.pck4(data);
		else if (data.buffer[18]==1)	euc.temp.pck1(data);	//master
		else if (data.buffer[18]==7)	euc.temp.pck7(data);	//extended, hardware pwm
		//haptic
		euc.temp.hapt();
	}
};
euc.temp.pck0=function(data) {
	//volt-battery
	euc.dash.live.volt=(data.getUint16(2)*(euc.dash.opt.bat.pack/16))/100; //bms=1 67.2 ,1.25 84, 1.5 100,8
	euc.dash.live.bat=Math.round( 100*(euc.dash.live.volt*(100/euc.dash.opt.bat.pack) - euc.dash.opt.bat.low ) / (euc.dash.opt.bat.hi-euc.dash.opt.bat.low) );
	euc.log.batL.unshift(euc.dash.live.bat);
	if (20<euc.log.batL.length) euc.log.batL.pop();
	euc.dash.alrt.bat.cc = (50 <= euc.dash.live.bat)? 0 : (euc.dash.live.bat <= euc.dash.alrt.bat.hapt.low)? 2 : 1;
	if ( euc.dash.alrt.bat.hapt.en && euc.dash.alrt.bat.cc ==2 )  euc.is.alert ++;
	// calculate speed limit.
    let rdct = 1 - (100 - euc.dash.live.bat) / 450;
	euc.dash.alrt.spd.max= euc.dash.alrt.spd.top * rdct;
	//speed
	euc.dash.live.spd = Math.abs((data.getInt16(4) * 3.6)/100);
	if (euc.dash.trip.topS < euc.dash.live.spd) euc.dash.trip.topS = euc.dash.live.spd;
	euc.dash.alrt.spd.cc = ( euc.dash.alrt.spd.hapt.hi <= euc.dash.live.spd )? 2 : ( euc.dash.alrt.spd.hapt.low <= euc.dash.live.spd )? 1 : 0 ;
	if ( euc.dash.alrt.spd.hapt.en && euc.dash.alrt.spd.cc == 2 )
		euc.is.alert = 1 + Math.round((euc.dash.live.spd-euc.dash.alrt.spd.hapt.hi) / euc.dash.alrt.spd.hapt.step) ;
	//trip last
	//euc.dash.trip.last=data.getUint32(6)/1000;
	euc.dash.trip.last=data.getUint16(8)/1000;
	//amp
	euc.dash.live.amp=data.getInt16(10)/1000;
	if (euc.dash.opt.unit.ampR) euc.dash.live.amp=-euc.dash.live.amp;
	euc.log.ampL.unshift(Math.round(euc.dash.live.amp));
	if (20<euc.log.ampL.length) euc.log.ampL.pop();
	euc.dash.alrt.amp.cc = ( euc.dash.alrt.amp.hapt.hi <= euc.dash.live.amp || euc.dash.live.amp <= euc.dash.alrt.amp.hapt.low )? 2 : ( euc.dash.live.amp  <= -0.5 || 15 <= euc.dash.live.amp)? 1 : 0;
	if (euc.dash.alrt.amp.hapt.en && euc.dash.alrt.amp.cc==2) {
		if (euc.dash.alrt.amp.hapt.hi<=euc.dash.live.amp)	euc.is.alert =  euc.is.alert + 1 + Math.round( (euc.dash.live.amp - euc.dash.alrt.amp.hapt.hi) / euc.dash.alrt.amp.hapt.step) ;
		else euc.is.alert =  euc.is.alert + 1 + Math.round(-(euc.dash.live.amp - euc.dash.alrt.amp.hapt.low) / euc.dash.alrt.amp.hapt.step) ;
	}
	//temp
	euc.dash.live.tmp=(data.getInt16(12) /340.0)+36.53;
	euc.dash.alrt.tmp.cc=(euc.dash.alrt.tmp.hapt.hi - 5 <= euc.dash.live.tmp )? (euc.dash.alrt.tmp.hapt.hi <= euc.dash.live.tmp )?2:1:0;
	if (euc.dash.alrt.tmp.hapt.en && euc.dash.alrt.tmp.cc==2) euc.is.alert++;
	//pwm. hardware mode never estimates: frame 7 if the wheel sends it, else frame 0 on
	//custom firmware (tenths of a percent), else a flat 0 saying this wheel reports none.
	if (!euc.dash.alrt.pwm.hw) euc.temp.pwmEst();
	else if (!euc.temp.tPwm) euc.temp.pwmSet(euc.temp.hwPwm?Math.abs(data.getInt16(14))/10:0);
	//volume
	euc.dash.vol=data.getUint16(16);
};
euc.temp.pck1=function(data) {
  euc.dash.alrt.pwm.val = data.getUint16(2);
};
//sent by main boards with firmware after 09.2024
euc.temp.pck7=function(data) {
	//motor temp, whole degrees
	euc.dash.live.tmpM = data.getInt16(6);
	//pwm, whole percent
	let p = data.getInt16(8);
	if (Math.abs(p)) euc.temp.tPwm=1;
	if (euc.dash.alrt.pwm.hw && euc.temp.tPwm) euc.temp.pwmSet(Math.abs(p));
};
euc.temp.pck4=function(data) {
	euc.dash.trip.totl=data.getUint32(2)/1000;
	euc.log.trip.forEach(function(val,pos){ if (!val) euc.log.trip[pos]=euc.dash.trip.totl;});
	let mode=data.getUint16(6);
	euc.dash.opt.ride.mode	= mode >> 13 & 0x3; //riding mode
	euc.dash.alrt.mode	= mode >> 10 & 0x3; //warnings mode
	euc.dash.opt.ride.rolA	= mode >>  7 & 0x3; //roll angle
	euc.dash.opt.unit.mile	= mode & 0x1; //speed unit
	//
	euc.dash.auto.offT = data.getUint16(8);
	euc.dash.alrt.spd.tilt.val= data.getUint16(10);
	euc.dash.opt.lght.led = data.getUint16(12);
	//alarm error
	euc.dash.alrt.warn.code = data.getUint8(14);
	if (euc.dash.alrt.warn.code){
		let faultAlarmLine = '';
		for (let bit = 0; bit < 8; bit++) {
			if (euc.dash.alrt.warn.code >> bit & 0x1)
			faultAlarmLine += euc.temp.faultAlarms(bit) + ', ';
		}
		faultAlarmLine = faultAlarmLine.slice(0, -2);
		euc.dash.alrt.warn.txt=faultAlarmLine;
		//updatePwmAlarmSpeed
		if (euc.dash.alrt.warn.code & 0x1 ){
			euc.dash.alrt.pwr=1;
			if (euc.dash.alrt.spd.max == 0 || euc.dash.live.spd < euc.dash.alrt.spd.max ){
				euc.dash.alrt.spd.max=euc.dash.live.spd;
				let speed_reduction = 1 - (100 - euc.dash.live.bat) / 450;
				euc.dash.alrt.spd.top = (euc.dash.live.spd / speed_reduction).toFixed(1);
			}
		}
	}else euc.dash.alrt.pwr=0;
	//log
	euc.log.almL.unshift(euc.dash.alrt.pwr);
	if (20<euc.log.almL.length) euc.log.almL.pop();
	//light status
	euc.dash.opt.lght.HL = data.getUint8(15);
};

euc.temp.init=function(c) {
	let hlc=[0,"lightsOn","lightsOff","lightsStrobe"];
	c.writeValue(euc.cmd(euc.dash.auto.onC.HL?hlc[euc.dash.auto.onC.HL]:"none")).then(function() {
		return c.writeValue(euc.cmd(euc.dash.auto.onC.beep?"beep":"none"));
	}).then(function() {
		return euc.wri(euc.dash.auto.onC.led?("ledMode",euc.dash.auto.onC.led-1):"none");
	}).then(function() {
		if (!euc.dash.info.get.modl){
			console.log("model not found,fetch");
			return c.writeValue(euc.cmd("fetchModel"));
		}
	}).then(function() {
		if (!euc.dash.info.get.firm)
			return c.writeValue(euc.cmd("fetchFirmware"));
	}).then(function() {
		euc.is.run=1;
		return c.startNotifications();
	}).catch(euc.off);

};
euc.temp.exit=function(c) {
	if (euc.gatt && euc.gatt.connected) {
		let hld=["none","lightsOn","lightsOff","lightsStrobe"];
		c.writeValue(euc.cmd(hld[euc.dash.auto.onD.HL])).then(function() {
			return c.writeValue(euc.cmd(euc.dash.auto.onD.beep?"beep":"none"));
		}).then(function() {
			return euc.wri(euc.dash.auto.onD.led?("ledMode",euc.dash.auto.onD.led-1):"none");
		}).then(function() {
			euc.is.run=0;
			return c.stopNotifications();
		}).then(function() {
			euc.gatt.disconnect();
		}).catch(euc.off);
	}else {
		if (euc.tout.busy) {clearTimeout(euc.tout.busy);euc.tout.busy=0;}
		euc.state="OFF";
		euc.off("not connected");
		return;
	}
};

euc.temp.read=function(){};
euc.temp.read.replaceWith(euc.temp.main);
euc.isProxy=0;
euc.is.run=0;
//start
euc.wri=function(i) {if (euc.dbg) console.log("not connected yet"); if (i=="end") euc.off(); return;};
euc.conn=function(mac){
	euc.dash.trip.pwm=0;
	//euc.temp.tPwm / euc.temp.hwPwm are not cleared here on purpose: euc.temp is
	//rebuilt per session in euc.js, so both latches survive a reconnect, and the
	//firmware banner is only re-fetched when info.get.firm is still empty. They pick
	//the source inside hardware mode, they no longer pick hardware over software:
	//that is euc.dash.alrt.pwm.hw, set by hand on the dash options screen.
	//check if connected
	if ( euc.gatt!="undefined") {
		if (euc.gatt.connected) {euc.gatt.disconnect();return;}
	}
	//check if proxy
	if (mac.includes("private-resolvable")&&!euc.isProxy ){
		let name=require("Storage").readJSON("dash.json",1)["slot"+require("Storage").readJSON("dash.json",1).slot+"Name"];
		NRF.requestDevice({ timeout:2000, filters: [{ namePrefix: name }] }).then(function(device) { euc.isProxy=1;euc.conn(device.id);}  ).catch(function(err) {print ("error "+err);euc.conn(euc.mac); });
		return;
	}
	euc.isProxy=0;
	//connect
	NRF.connect(mac,{minInterval:7.5, maxInterval:15})
	.then(function(g) {
		euc.gatt=g;
	   return g.getPrimaryService(0xffe0);
	}).then(function(s) {
	  return s.getCharacteristic(0xffe1);
	//read
	}).then(function(c) {
		euc.temp.last= [];
		c.on('characteristicvaluechanged',  euc.temp.read);
		euc.gatt.device.on('gattserverdisconnected', euc.off);
		return  c;
	//write
	}).then(function(c) {
		console.log("EUC Begode connected!");
		euc.wri= function(n,v) {
			if (euc.tout.busy) { clearTimeout(euc.tout.busy);euc.tout.busy=setTimeout(()=>{euc.tout.busy=0;},150);return;}
			euc.tout.busy=setTimeout(()=>{euc.tout.busy=0;},100);
			//end
			if (n==="proxy") {
				c.writeValue(euc.proxy.buffer[0]).then(function() {
					euc.proxy.buffer.shift();
					if (euc.proxy.buffer[0]) return c.writeValue(euc.proxy.buffer[0])
				}).then(function() {
					euc.proxy.buffer.shift();
					if (euc.proxy.buffer[0]) return c.writeValue(euc.proxy.buffer[0])
				}).then(function() {
					euc.proxy.buffer.shift();
					if (euc.proxy.buffer[0]) return c.writeValue(euc.proxy.buffer[0])
				}).catch(euc.off);
			}else if (euc.state=="OFF"||n=="end") {
				euc.temp.exit(c);
			} else if (n==="start") {
				if (euc.is.run) c.startNotifications();
				else euc.temp.init(c);
				setTimeout(()=>{euc.state="READY";},500);
			}else{
				let cob=euc.cmd(n,v);
				if (!cob[0]) return;
				c.writeValue(cob[0]).then(function() {
					return cob[1]? c.writeValue(cob[1]):"ok";
				}).then(function() {
					return cob[2]? c.writeValue(cob[2]):"ok";
				}).then(function() {
					return cob[3]? c.writeValue(cob[3]):"ok";
				}).catch(euc.off);
			}
		};
		//init garage slot
		if (!ew.do.fileRead("dash","slot"+ew.do.fileRead("dash","slot")+"Mac")) {
			euc.dash.info.get.mac=euc.mac;
			ew.do.fileWrite("dash","slot"+ew.do.fileRead("dash","slot")+"Mac",euc.mac);
		}
		//start wheel init
		buzzer.nav([90,40,150]);
		setTimeout(() => {euc.wri("start");}, 500);
	//reconect
	}).catch(euc.off);
};
