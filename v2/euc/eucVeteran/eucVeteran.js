//Vteran euc module
E.setFlags({ pretokenise: 1 });
//Leaperkim settings frame: "L?Ap", total length, payload, CRC32 big endian over the rest.
//The payload is an image of the wheel's settings block and 0x80 means "leave unchanged",
//so only the slot being written carries a value. Same CRC as the inbound DC 5A 5C frames.
//len is the payload length, which has to reach the slot being written
euc.temp.lkSet=function(cmd,blk,slot,val,len){
	let n=(len||8)+9;
	let f=new Uint8Array(n);
	f.set([0x4c,cmd,0x41,0x70,n]);
	f.fill(0x80,5,n-4);
	f[5]=1; f[6]=blk; f[5+slot]=val;
	let crc=E.CRC32(new Uint8Array(f.buffer,0,n-4));
	f[n-4]=(crc>>>24)&255; f[n-3]=(crc>>>16)&255; f[n-2]=(crc>>>8)&255; f[n-1]=crc&255;
	return f;
};
euc.cmd=function(no,v){
	switch (no) {
		//Veteran has no beep command, re-sending the current pedal mode makes the wheel beep
		case "beep":return ["SETs","SETm","SETh"][euc.dash.opt.ride.mode-1]||"SETm";
		case "rideSoft":return "SETs";
		case "rideMed":return  "SETm";
		case "rideStrong":return "SETh";
		case "setLightOn":return "SetLightON";
		case "setLightOff":return "SetLightOFF";
		case "setVolUp":return "SetFctVol+";
		case "setVolDn":return "SetFctVol-";
		case "clearMeter":return "CLEARMETER";
		//speed alarm, slot 7 of the 0x6b block. The Leaperkim app sends both generations
		//back to back rather than working out which one the wheel wants, so alrtSpd2 is
		//the same value in the 0x64 block and euc.wri sends the pair.
		case "alrtSpd": return euc.temp.lkSet(0x6b,0x80,7,v);
		case "alrtSpd2":return euc.temp.lkSet(0x64,0,7,v);
		//speed limit, slot 7 of the 0x64 block, a different setting from the alarm
		case "limtSpd": return euc.temp.lkSet(0x64,2,7,v);
		//the three percent settings the new wheels have in place of the 1-3 pedal modes.
		//Leaperkim calls them pedal softness, acceleration and deceleration assist, and
		//accelerometer reduction. The payload has to reach the slot, so these run to 33
		//bytes, well past the frames anything else here writes.
		case "pedHard": return euc.temp.lkSet(0x64,2,5,v,6);
		case "pedAsst": return euc.temp.lkSet(0x64,2,21,v,22);
		case "pedComp": return euc.temp.lkSet(0x64,2,23,v,24);
		case "switchPackets": euc.temp.CHANGESTRORPACK=1; return "CHANGESTRORPACK";
		case "changePage": euc.temp.CHANGESTRORPACK++; return "CHANGESHOWPAGE";
		case "returnMain": euc.temp.CHANGESTRORPACK=0;return "CHANGESTRORPACK";
		default: return [];
    }
};
//
function checksum(packet) {
  // Skip check if old firmware
  let FWVer = packet[28]<<8|packet[29];
  if (FWVer < 3012) {
    if (ew.is.bt===2) console.log("Firmware does not support checksum. FWVer: ", FWVer);
    return 1;
  }

  if (ew.is.bt===2) console.log("Checksum verification");

  let tCRC32View=new DataView(packet, packet.length-4, 4);
  let tPckt=new Uint8Array(packet, 0, packet.length-4);
  if (E.CRC32(tPckt) == tCRC32View.getUint32(0)) return 1;
  else return 0;
}
//
euc.isProxy=0;
//
euc.temp.liveParse = function (inc){
  let lala = new DataView(inc);
  euc.is.alert=0;
  //body length, byte 3. Anything past it is the CRC, so an offset is only readable
  //while blen is greater than it. The long frames carry a sub packet selected by byte 46.
  let blen=lala.getUint8(3);
  let sub=(46<blen)?lala.getUint8(46):-1;
  let chrg=lala.getUint8(23);
  //print(this.ev);
  //volt-bat
  euc.dash.live.volt=lala.getUint16(4)/100;
  euc.dash.live.bat=Math.round(100*(euc.dash.live.volt*(100/euc.dash.opt.bat.pack) - euc.dash.opt.bat.low ) / (euc.dash.opt.bat.hi-euc.dash.opt.bat.low));
  euc.log.batL.unshift(euc.dash.live.bat);
  if (20<euc.log.batL.length) euc.log.batL.pop();
  euc.dash.alrt.bat.cc = (50 <= euc.dash.live.bat)? 0 : (euc.dash.live.bat <= euc.dash.alrt.bat.hapt.low)? 2 : 1;
  if ( euc.dash.alrt.bat.hapt.en && euc.dash.alrt.bat.cc ==2 )  euc.is.alert ++;
  //spd
  euc.dash.live.spd=Math.abs(lala.getInt16(6)/10);
  if (euc.dash.trip.topS < euc.dash.live.spd) euc.dash.trip.topS = euc.dash.live.spd;
  euc.dash.alrt.spd.cc = ( euc.dash.alrt.spd.hapt.hi <= euc.dash.live.spd )? 2 : ( euc.dash.alrt.spd.hapt.low <= euc.dash.live.spd )? 1 : 0 ;
  if ( euc.dash.alrt.spd.hapt.en && euc.dash.alrt.spd.cc == 2 )
    euc.is.alert = 1 + Math.round((euc.dash.live.spd-euc.dash.alrt.spd.hapt.hi) / euc.dash.alrt.spd.hapt.step);
  //trip
  euc.dash.trip.last=(lala.getUint16(10)<<16 | lala.getUint16(8))/1000;
  euc.dash.trip.totl=(lala.getUint16(14)<<16 | lala.getUint16(12))/1000;
  euc.log.trip.forEach(function(val,pos){ if (!val) euc.log.trip[pos]=euc.dash.trip.totl;});
  //pwm, needed before the current because the bus current is derived from it
  let pwmRaw=lala.getUint16(34);
  euc.dash.live.pwm=Math.round(pwmRaw/100);
  if (euc.dash.trip.pwm < euc.dash.live.pwm) euc.dash.trip.pwm = euc.dash.live.pwm;
  //amp. Offset 16 is the *phase* current in tenths of an amp; the current the phone apps
  //show is the bus current, which is the phase current times the duty cycle. The Leaperkim
  //app does exactly this: abs(phase)/10 * pwmRaw/10000. Showing the raw phase value made
  //the field swing +/-15A at walking pace while the real bus current sat near zero.
  //The sign is kept so braking still reads negative; both phone apps drop it, but their
  //sign convention differs by firmware version and unit.ampR already flips it here.
  euc.dash.live.phas=lala.getInt16(16)/10;
  euc.dash.live.amp=euc.dash.live.phas*pwmRaw/10000;
  //on the charger the wheel reports the charging current instead, negative, offset 63.
  //Only sub packets 0 and 4 carry it, one frame in four, so it has to be latched: on the
  //six frames in between the wheel is parked, phase and pwm are both zero, so the field
  //would fall back to 0A and read 0,0,0,-4,0,0,0,-4 rather than a steady charge rate.
  if (!chrg) euc.temp.chgA=0;
  else if ((sub===0||sub===4) && 64<blen) euc.temp.chgA=(lala.getInt16(63)<0)?lala.getInt16(63)/10:0;
  if (euc.temp.chgA) euc.dash.live.amp=euc.temp.chgA;
  if (euc.dash.opt.unit.ampR) euc.dash.live.amp=-euc.dash.live.amp;
  euc.log.ampL.unshift(euc.dash.live.amp);
  if (20<euc.log.ampL.length) euc.log.ampL.pop();
  euc.dash.alrt.amp.cc = ( euc.dash.alrt.amp.hapt.hi <= euc.dash.live.amp || euc.dash.live.amp <= euc.dash.alrt.amp.hapt.low )? 2 : ( euc.dash.live.amp  <= -0.5 || 15 <= euc.dash.live.amp)? 1 : 0;
  if (euc.dash.alrt.amp.hapt.en && euc.dash.alrt.amp.cc==2) {
    if (euc.dash.alrt.amp.hapt.hi<=euc.dash.live.amp)	euc.is.alert =  euc.is.alert + 1 + Math.round( (euc.dash.live.amp - euc.dash.alrt.amp.hapt.hi) / euc.dash.alrt.amp.hapt.step);
    else euc.is.alert =  euc.is.alert + 1 + Math.round(-(euc.dash.live.amp - euc.dash.alrt.amp.hapt.low) / euc.dash.alrt.amp.hapt.step);
  }
  //tmp, control board temperature
  euc.dash.live.tmp=lala.getInt16(18)/100;
  euc.dash.alrt.tmp.cc=(euc.dash.alrt.tmp.hapt.hi - 5 <= euc.dash.live.tmp )? (euc.dash.alrt.tmp.hapt.hi <= euc.dash.live.tmp )?2:1:0;
  if (euc.dash.alrt.tmp.hapt.en && euc.dash.alrt.tmp.cc==2) euc.is.alert++;
  //cpu temperature, only in the long frames. EUC World reads it here, the Leaperkim app
  //does not read it at all, so leave tmpM undefined when the wheel does not send it.
  if ((sub===0||sub===4) && 62<blen) euc.dash.live.tmpM=lala.getInt16(61)/100;
  //a third sensor, 22.9C on a wheel reading 30.2 at the board and 37.4 at the cpu. EUC
  //World treats it as the main temperature on new firmware; which sensor it is is unknown,
  //so it is carried without a name.
  if ((sub===0||sub===4) && 60<blen) euc.dash.live.tmpA=lala.getInt16(59)/100;
  //battery temperature status, offset 36. 111 = every sensor normal, 100/101/110 = one or
  //more high, anything else the Leaperkim app shows as unknown.
  if (37<blen) euc.dash.live.batT=lala.getUint16(36);
  //settings readback, sub packet 8, the one WheelLog leaves as "new packet, TODO". Only
  //the three the wheel calls pedal softness, acceleration/deceleration assist and
  //accelerometer reduction are taken; 0x80 means this firmware does not have the setting.
  if (sub===8) {
    if (50<blen) euc.dash.opt.ride.hard=lala.getUint8(50);
    if (66<blen) euc.dash.opt.ride.asst=lala.getUint8(66);
    if (68<blen) euc.dash.opt.ride.comp=lala.getUint8(68);
  }
  //offset 24 is the wheel's speed alarm and 26 its speed limit, both tenths of a km/h.
  //This was stored as trip.avrS, which it is not: it never varies with speed. A limit of
  //200 is the wheel's "off" position; the Leaperkim app can only set 10..120.
  euc.dash.alrt.spd.alrm=lala.getUint16(24)/10;
  euc.dash.alrt.spd.max=lala.getUint16(26)/10;
  if (!euc.dash.info.get.modl) euc.dash.info.get.modl=lala.getUint16(28);
  //ride mode is byte 31 alone. Byte 30 belongs to the version code, which the Leaperkim
  //app builds from bytes 30, 28, 29.
  euc.dash.opt.ride.mode=lala.getUint8(31);
  //alerts
  if (euc.dash.alrt.pwm.hapt.en && (euc.dash.alrt.pwr || euc.dash.alrt.pwm.hapt.hi <= euc.dash.live.pwm)) {
    buzzer.sys( 60);
    euc.is.alert = 0;
  } else if (!euc.is.buzz && euc.is.alert) {
    if (!w.gfx.isOn&&(euc.dash.alrt.spd.cc||euc.dash.alrt.amp.cc||euc.dash.alrt.pwr)) face.go(ew.is.dash[ew.def.dash.face],0);
    //else face.off(6000);
    euc.is.buzz=1;
    if (20<=euc.is.alert) euc.is.alert=20;
    var a = [100];
    while (5 <= euc.is.alert) {
      a.push(150,500);
      euc.is.alert=euc.is.alert-5;
    }
    for (let i = 0; i < euc.is.alert ; i++) a.push(150,150);
    buzzer.euc(a);
    setTimeout(() => {euc.is.buzz=0; }, 3000);
  }
}
//
euc.temp.inpk = function(event) {
  if (euc.is.busy) return;
  let inc=event.target.value.buffer;
  if (ew.is.bt==5) euc.proxy.w(inc);

  if ( inc.length>4 && inc[0]==0xDC && inc[1]==0x5A && inc[2]==0x5C ) euc.temp.tot=E.toUint8Array(inc);
  else if (euc.temp.tot.buffer.length>1) euc.temp.tot=E.toUint8Array(euc.temp.last,inc);
  else return;
  euc.temp.last=E.toUint8Array(euc.temp.tot.buffer);

  let needBufLen=euc.temp.tot.buffer[3] + 4;
  if (euc.temp.tot.buffer.length < needBufLen) return;

  if (euc.temp.tot.buffer.length == needBufLen) {
    if (ew.is.bt===2) console.log("Veteran: in: length:",euc.temp.tot.buffer.length," data :",[].map.call(euc.temp.tot, x => x.toString(16)).toString());
    if (checksum(euc.temp.tot.buffer)) {
      euc.temp.liveParse(euc.temp.tot.buffer);
    } else {
      if (ew.is.bt===2) console.log("Packet checksum error. Dropped.");
    }
  } else if (ew.is.bt===2) console.log("Packet size error. Dropped.");

  euc.temp.tot=E.toUint8Array([0]);
  euc.temp.last=E.toUint8Array(euc.temp.tot.buffer);
}
//start
euc.wri=function(i) {if (ew.def.cli) console.log("not connected yet"); if (i=="end") euc.off(); return;};
euc.conn=function(mac){
	euc.dash.trip.pwm=0;
	euc.temp.chgA=0;
	//check
	if ( euc.gatt!="undefined") {
		if (ew.def.cli) print("ble allready connected");
		if (euc.gatt.connected) {euc.gatt.disconnect();return;}
	}
	//check if proxy
	if (mac.includes("private-resolvable")&&!euc.isProxy ){
		let name=require("Storage").readJSON("dash.json",1)["slot"+require("Storage").readJSON("dash.json",1).slot+"Name"];
		NRF.requestDevice({ timeout:2000, filters: [{ namePrefix: name }] }).then(function(device) { euc.isProxy=1;euc.conn(device.id);}  ).catch(function(err) {print ("error "+err);euc.conn(euc.mac); });
		return;
	}
	euc.isProxy=0;
	euc.pac=[];
	//connect
	NRF.connect(mac,{minInterval:7.5, maxInterval:15})
	.then(function(g) {
		euc.gatt=g;
	   return g.getPrimaryService(0xffe0);
	}).then(function(s) {
	  return s.getCharacteristic(0xffe1);
	//read
	}).then(function(c) {
		this.need=0;
		//this.event=new Uint8Array(event.target.value.buffer);
		c.on('characteristicvaluechanged', euc.temp.inpk);
		//on disconnect
		euc.gatt.device.on('gattserverdisconnected', euc.off);
		return  c;
	//write
	}).then(function(c) {
		console.log("EUC Veteran connected!!");
		euc.wri= function(n,v) {
            //console.log("got :", n);
			if (euc.tout.busy) { clearTimeout(euc.tout.busy);euc.tout.busy=setTimeout(()=>{euc.tout.busy=0;},100);return;}
			euc.tout.busy=setTimeout(()=>{euc.tout.busy=0;},200);
            //end
			if (n==="proxy") {
				c.writeValue(v).then(function() {
                    if (euc.tout.busy) {clearTimeout(euc.tout.busy);euc.tout.busy=0;}
				}).catch(euc.off);
			}else if (n=="hornOn") {
				euc.is.horn=1;
				let md={"1":"SETs","2":"SETm","3":"SETh"};
				c.writeValue(md[euc.dash.opt.ride.mode]).then(function() {
					if (!euc.is.busy) {euc.is.busy=1;euc.is.horn=1;c.stopNotifications();}
					setTimeout(() => {
						c.writeValue((euc.dash.opt.lght.HL)?"SetLightOFF":"SetLightON").then(function() {
							setTimeout(() => {
								c.writeValue((euc.dash.opt.lght.HL)?"SetLightON":"SetLightOFF").then(function() {
									setTimeout(() => {
										if (BTN1.read()) {
											if (euc.tout.busy) { clearTimeout(euc.tout.busy);euc.tout.busy=0;}
											euc.wri("hornOn");
										}else {
											euc.is.horn=0;
											euc.is.busy=0;
											c.startNotifications();
										}
									},30);
								});
							},30);
						});
					},60);
				});
			}else if (n=="hornOff") {
				euc.is.horn=0;
			}else if (n=="start") {
				c.startNotifications().then(function() {
					buzzer.nav([100,100,150,]);
					if (euc.dash.auto.onC.HL) return c.writeValue(euc.cmd((euc.dash.auto.onC.HL==1)?"setLightOn":"setLightOff"));
				}).then(function() {
					if (euc.dash.auto.onC.clrM) return c.writeValue(euc.cmd("clearMeter"));
				}).then(function()  {
					//if (euc.dash.auto.onC.rstT) {}
					euc.is.run=1;
					//beep repeats the current pedal mode, wait for the first packets to report it
					//and stay clear of the 200ms write debounce in euc.wri
					if (euc.dash.auto.onC.beep) setTimeout(() => {euc.wri("beep");},600);
					return true;
				});
			}else if (euc.state=="OFF"||n=="end") {
				let hld=["none","setLightOn","setLightOff"];
				Promise.resolve().then(function() {
					if (euc.dash.auto.onD.HL) return c.writeValue(euc.cmd(hld[euc.dash.auto.onD.HL]));
				}).then(function() {
					if (!euc.dash.auto.onD.beep) return;
					//give the wheel time to beep before the link is dropped
					return c.writeValue(euc.cmd("beep")).then(function() {
						return new Promise(function(r){setTimeout(r,150);});
					});
				}).then(function() {
					euc.is.run=0;
					return c.stopNotifications();
				}).then(function() {
					euc.gatt.disconnect();
				}).catch(euc.off);
			}else if (n=="alrtSpd") {
				//both generations, spaced the way the Leaperkim app spaces them
				c.writeValue(euc.cmd("alrtSpd",v)).then(function() {
					return new Promise(function(r){setTimeout(r,60);});
				}).then(function() {
					return c.writeValue(euc.cmd("alrtSpd2",v));
				}).then(function() {
					if (euc.tout.busy) {clearTimeout(euc.tout.busy);euc.tout.busy=0;}
				}).catch(euc.off);
			}else if (n=="pedHard"||n=="pedAsst"||n=="pedComp") {
				//15, 31 and 33 bytes. Everything else this watch writes fits inside the 20
				//byte default MTU, so a rejection here most likely means the link never
				//negotiated a bigger one. Report it rather than dropping the wheel.
				euc.temp.wErr=0;
				c.writeValue(euc.cmd(n,v)).then(function() {
					if (euc.tout.busy) {clearTimeout(euc.tout.busy);euc.tout.busy=0;}
				}).catch(function(err) {
					euc.temp.wErr=1;
					if (euc.tout.busy) {clearTimeout(euc.tout.busy);euc.tout.busy=0;}
					if (ew.is.bt===2) console.log("Veteran: setting write failed:",err);
				});
            }else {
				let cmd=euc.cmd(n,v);
				if (!cmd.length) return;
				c.writeValue(cmd).then(function() {
					if (euc.tout.busy) {clearTimeout(euc.tout.busy);euc.tout.busy=0;}
				}).catch(euc.off);
			}
		};
		if (!ew.do.fileRead("dash","slot"+ew.do.fileRead("dash","slot")+"Mac")) {
			euc.dash.info.get.mac=euc.mac; euc.dash.opt.bat.hi=420;euc.dash.opt.bat.low=315;
			euc.updateDash(require("Storage").readJSON("dash.json",1).slot);
			ew.do.fileWrite("dash","slot"+ew.do.fileRead("dash","slot")+"Mac",euc.mac);
		}
		euc.state="READY";euc.wri("start");
	//reconect
	}).catch(euc.off);
};

//euc.wri("changePage")
//euc.wri("switchPackets")
//euc.wri("returnMain")
