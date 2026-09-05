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
    case 'tiltbackOff':     return [98, 34, 98, 98];
    case 'tiltbackSpeed':   return [98, 87, 89, Math.floor(param / 10) + 48, param % 10 + 48, 98, 98];
    case 'volume':          return [87, 66, 48 + param, 98];
    case 'ledMode':         return [87, 77, 48 + param, 98];
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
//the two custom ones report pwm in the live frame, stock does not. BF is Alexovik's
//protocol: same frame numbers, several fields mean something else, so it gets its own
//latch. matched on the trimmed chunk the way WheelLog does, not on a word at offset 0.
euc.temp.firm=function(s){
	let p=s.slice(0,2);
	if (p!="GW" && p!="JN" && p!="CF" && p!="BF") return 0;
	euc.temp.hwPwm = (p=="CF"||p=="BF")?1:0;
	euc.temp.alx = (p=="BF")?1:0;
	return 1;
};
//one command at a time, and one byte at a time. the wheel sits behind a serial to ble
//bridge with no flow control, so a multi byte command has to be spaced the way WheelLog
//spaces it or the wheel misses bytes.
euc.temp.q=[];
euc.temp.lock=0;
euc.temp.busy=function(ms){
	if (euc.tout.busy) clearTimeout(euc.tout.busy);
	euc.tout.busy=setTimeout(function(){
		euc.tout.busy=0;
		let h=euc.temp.q.shift();
		if (h) euc.wri(h[0],h[1]);
	},ms);
};
euc.temp.seq=function(c,cob,gap){
	return new Promise(function(done,fail){
		let i=0;
		let step=function(){
			c.writeValue(cob[i]).then(function(){
				if (++i<cob.length) setTimeout(step,gap);
				else done();
			}).catch(fail);
		};
		step();
	});
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
	} else { // model/firm banner
		//matched on the trimmed chunk, as WheelLog does. the old test read a word at
		//offset 0, so a reply with any leading byte was thrown away for the whole ride.
		let s = E.toString(event.target.value.buffer).trim();
		if (s.slice(0,4)=="NAME") { //fetchModel
			console.log("model fetch responce:",event.target.value.buffer);
			euc.dash.info.get.modl = s.slice(5).trim();
			if (euc.dash.info.get.modl=="Barton") euc.dash.info.get.modl="RecioWheel";
			if (!ew.do.fileRead("dash","slot"+ew.do.fileRead("dash","slot")+"Model"))
				ew.do.fileWrite("dash","slot"+ew.do.fileRead("dash","slot")+"Model",euc.dash.info.get.modl);
			//no per model table: pack, empty cell and free spin speed are set in dash options
		} else if (euc.temp.firm(s)) { //fetchFirmware
			euc.dash.info.get.firm = s.slice(2).trim();
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
	//trip last. on Alexovik firmware offset 8 is battery current, not distance
	//euc.dash.trip.last=data.getUint32(6)/1000;
	if (!euc.temp.alx) euc.dash.trip.last=data.getUint16(8)/1000;
	//amp, phase current. hundredths of an amp, tenths on Alexovik firmware.
	//this was /1000, which put it 10x low and left the thresholds below unreachable.
	euc.dash.live.amp=data.getInt16(10)/(euc.temp.alx?10:100);
	if (euc.dash.opt.unit.ampR) euc.dash.live.amp=-euc.dash.live.amp;
	euc.log.ampL.unshift(Math.round(euc.dash.live.amp));
	if (20<euc.log.ampL.length) euc.log.ampL.pop();
	euc.dash.alrt.amp.cc = ( euc.dash.alrt.amp.hapt.hi <= euc.dash.live.amp || euc.dash.live.amp <= euc.dash.alrt.amp.hapt.low )? 2 : ( euc.dash.live.amp  <= -0.5 || 15 <= euc.dash.live.amp)? 1 : 0;
	if (euc.dash.alrt.amp.hapt.en && euc.dash.alrt.amp.cc==2) {
		if (euc.dash.alrt.amp.hapt.hi<=euc.dash.live.amp)	euc.is.alert =  euc.is.alert + 1 + Math.round( (euc.dash.live.amp - euc.dash.alrt.amp.hapt.hi) / euc.dash.alrt.amp.hapt.step) ;
		else euc.is.alert =  euc.is.alert + 1 + Math.round(-(euc.dash.live.amp - euc.dash.alrt.amp.hapt.low) / euc.dash.alrt.amp.hapt.step) ;
	}
	//temp, mpu6050 on stock, mpu6500 on Alexovik firmware
	euc.dash.live.tmp=euc.temp.alx?(data.getInt16(12)/333.87)+21.0:(data.getInt16(12)/340.0)+36.53;
	euc.dash.alrt.tmp.cc=(euc.dash.alrt.tmp.hapt.hi - 5 <= euc.dash.live.tmp )? (euc.dash.alrt.tmp.hapt.hi <= euc.dash.live.tmp )?2:1:0;
	if (euc.dash.alrt.tmp.hapt.en && euc.dash.alrt.tmp.cc==2) euc.is.alert++;
	//pwm. hardware mode never estimates: frame 7 if the wheel sends it, else frame 0 on
	//custom firmware (tenths of a percent), else a flat 0 saying this wheel reports none.
	if (!euc.dash.alrt.pwm.hw) euc.temp.pwmEst();
	else if (!euc.temp.tPwm) euc.temp.pwmSet(euc.temp.hwPwm?Math.abs(data.getInt16(14))/10:0);
	//volume, held off with the same counter, it is a setting the user can change.
	//Alexovik firmware puts a trick counter in this byte, not a volume.
	if (!euc.temp.alx && !euc.temp.lock) euc.dash.vol=data.getUint16(16);
};
euc.temp.pck1=function(data) {
	//Alexovik firmware sends riding mode here, everyone else sends the bms/pwm frame
	if (euc.temp.alx) {
		if (euc.temp.lock) euc.temp.lock--;
		else euc.dash.opt.ride.mode = data.getUint8(6) & 0x03;
		return;
	}
	euc.dash.alrt.pwm.val = data.getUint16(2);
};
//sent by main boards with firmware after 09.2024
euc.temp.pck7=function(data) {
	if (euc.temp.alx) return;
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
	//Alexovik firmware carries only distance here, its settings live in frame 0xFF
	if (euc.temp.alx) return;
	//a setting written a moment ago is not in the wheel's frames yet. euc.temp.lock holds
	//wheel state off for a couple of frames, WheelLog's lock_Changes, so the screen does
	//not snap back to the old value and send the wrong command on the next tap.
	if (euc.temp.lock) euc.temp.lock--;
	else {
		let mode=data.getUint16(6);
		euc.dash.opt.ride.mode	= mode >> 13 & 0x3; //riding mode
		euc.dash.alrt.mode	= mode >> 10 & 0x3; //warnings mode
		euc.dash.opt.ride.rolA	= mode >>  7 & 0x3; //roll angle
		euc.dash.opt.unit.mile	= mode & 0x1; //speed unit
		euc.dash.alrt.spd.tilt.val= data.getUint16(10);
		//led mode is byte 13 alone. reading it as a 16 bit word pulled byte 12 in as the
		//high half, which only agrees while byte 12 is zero.
		euc.dash.opt.lght.led = data.getUint8(13);
		//light status, low two bits. the labels in dashBegode are indexed with this, so a
		//stray high bit gave an undefined label and a broken strobe state.
		euc.dash.opt.lght.HL = data.getUint8(15) & 0x03;
	}
	//
	euc.dash.auto.offT = data.getUint16(8);
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
};

//WheelLog asks V then N over and over until the wheel answers, because one lost write or
//a reply split across two notifications otherwise leaves the banner empty for the whole
//ride, and an empty firmware banner also means euc.temp.hwPwm is never set, so hardware
//pwm silently reports 0. Retries never take the line from a settings write and never take
//the lockout, so a tap always wins over a retry.
euc.temp.fetch=function(c,n){
	euc.tout.fetch=0;
	if (euc.state=="OFF") return;
	if (euc.dash.info.get.firm && euc.dash.info.get.modl) return;
	if (30<=n) {
		//give up the way WheelLog does, so the rest of the dash stops waiting on it
		if (!euc.dash.info.get.firm) { euc.dash.info.get.firm="-"; euc.temp.hwPwm=0; euc.temp.alx=0; }
		if (!euc.dash.info.get.modl) euc.dash.info.get.modl="Begode";
		return;
	}
	if (!euc.tout.busy)
		c.writeValue(euc.cmd(euc.dash.info.get.firm?"fetchModel":"fetchFirmware")).catch(euc.off);
	euc.tout.fetch=setTimeout(function(){
		if (euc.temp && euc.temp.fetch) euc.temp.fetch(c,n+1);
	},300);
};
euc.temp.init=function(c) {
	let hlc=[0,"lightsOn","lightsOff","lightsStrobe"];
	//built as one byte string and sent spaced. an option that is off contributes no
	//bytes: euc.cmd("none") is an empty array and writeValue([]) can reject, which
	//would take the connection down through the .catch below.
	let cob=[];
	if (euc.dash.auto.onC.HL) cob=cob.concat(euc.cmd(hlc[euc.dash.auto.onC.HL]));
	if (euc.dash.auto.onC.beep) cob=cob.concat(euc.cmd("beep"));
	if (euc.dash.auto.onC.led) cob=cob.concat(euc.cmd("ledMode",euc.dash.auto.onC.led-1));
	euc.is.run=1;
	//hold the lockout for as long as this takes: whatever is queued behind it must not
	//start writing into the middle of the connect sequence.
	euc.temp.busy(100*cob.length+500);
	//notifications first: the model and firmware banners are the answer to what the fetch
	//loop writes and nothing is listening for them until this resolves.
	c.startNotifications().then(function() {
		if (cob.length) return euc.temp.seq(c,cob,100);
	}).then(function() {
		euc.temp.fetch(c,0);
	}).catch(euc.off);
};
euc.temp.exit=function(c) {
	if (euc.tout.fetch) {clearTimeout(euc.tout.fetch);euc.tout.fetch=0;}
	if (euc.gatt && euc.gatt.connected) {
		let hld=[0,"lightsOn","lightsOff","lightsStrobe"];
		let cob=[];
		if (euc.dash.auto.onD.HL) cob=cob.concat(euc.cmd(hld[euc.dash.auto.onD.HL]));
		if (euc.dash.auto.onD.beep) cob=cob.concat(euc.cmd("beep"));
		if (euc.dash.auto.onD.led) cob=cob.concat(euc.cmd("ledMode",euc.dash.auto.onD.led-1));
		let p=cob.length? euc.temp.seq(c,cob,100) : Promise.resolve();
		p.then(function() {
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
			//connect and disconnect are not settings, they never wait behind the lockout
			if (euc.state=="OFF"||n=="end") { euc.temp.q=[]; euc.temp.exit(c); return; }
			if (n==="start") {
				euc.temp.q=[];
				euc.temp.busy(1000);
				if (euc.is.run) c.startNotifications();
				else euc.temp.init(c);
				setTimeout(()=>{euc.state="READY";},500);
				return;
			}
			//one command at a time. anything asked for while a command is still going out
			//is held and sent when it finishes, so a double tap keeps both taps. proxy
			//traffic is not held, euc.proxy.buffer is already its queue.
			if (euc.tout.busy) {
				if (n!=="proxy" && euc.temp.q.length<4) euc.temp.q.push([n,v]);
				return;
			}
			if (n==="proxy") {
				euc.temp.busy(100);
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
				return;
			}
			let cob=euc.cmd(n,v);
			if (!cob.length) return;
			//calibration is the one command WheelLog spaces wider than 100ms
			let gap=(n==="calibrate")?300:100;
			euc.temp.busy(gap*(cob.length-1)+100);
			//the wheel keeps reporting the old value for a frame or two after a write.
			//WheelLog holds 5 frames for the multi byte writes, 2 for the single byte ones.
			euc.temp.lock=(1<cob.length)?5:2;
			euc.temp.seq(c,cob,gap).catch(euc.off);
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
