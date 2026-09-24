//Replays a recorded Xway stream through the Begode driver and the riding dash, no wheel
//needed, to tell whether the stream itself is what makes the watch slow.
//1. Web IDE, Storage (the disk icon), "Upload a file": rplXway.bin, keep the name.
//2. Garage on the Xway slot, no wheel connected.
//3. Paste this whole file into the console, then rpl.start(). rpl.stop() ends it and
//   reloads the slot from flash, so nothing replayed is kept. rpl.start(25) plays at
//   twice the rate.
//rpl.start(ms,size) cuts the stream into size byte chunks instead of 20, one every ms:
//rpl.start(7.5,3) is the same 400 bytes a second as 133 small notifications, which is
//what a module sending whatever it holds at every 7.5ms connection event would do.
//rplXway.bin is the whole of begode_xway_standing.log.txt (which is the ride, up to
//24 km/h, the two Xway captures have their labels swapped): 1200 chunks of 20 bytes,
//60 s, looped at the recorded 20 chunks a second. It stays in flash and is read a second
//(400 bytes) at a time, a P8 does not have the ram to hold it. Each chunk arrives as a
//fresh event object, as it does from the radio, so the per chunk cost is the real one
//apart from the radio itself.
global.rpl={
 p:0,
 n:0,
 sz:20,
 blk:0,
 tid:0,
 start:function(ms,size){
  if (this.tid) return;
  let f=require("Storage").read("rplXway.bin");
  if (!f) { print("upload rplXway.bin first"); return; }
  if (euc.state!="OFF") { print("disconnect the wheel first"); return; }
  if (euc.dash.info.get.makr!="Begode") { print("select the Xway slot in the garage first"); return; }
  this.n=f.length-f.length%400;
  f=0;
  this.p=0;
  this.sz=(size&&size<20)?size:20;
  euc.temp={count:0,loop:0,last:0,rota:0};
  eval(require("Storage").read("eucBegode"));
  euc.state="READY";
  face.go(ew.is.dash[ew.def.dash.face],0);
  this.tid=setInterval(function(){
   let r=rpl, k=r.p%400, l=r.sz;
   if (!k) r.blk=E.toUint8Array(require("Storage").read("rplXway.bin",r.p,400));
   //a chunk never crosses the 400 byte block, the one at its end comes out short
   if (400<k+l) l=400-k;
   euc.temp.read({target:{value:{buffer:new Uint8Array(r.blk.buffer,k,l)}}});
   r.p=(r.p+l)%r.n;
  },ms||50);
  print("replaying "+this.n+" bytes in "+this.sz+" byte chunks, rpl.stop() to end");
 },
 stop:function(){
  if (this.tid) clearInterval(this.tid);
  this.tid=0;
  this.blk=0;
  euc.state="OFF";
  euc.temp=0;
  euc.dash=require("Storage").readJSON("eucSlot"+require("Storage").readJSON("dash.json",1).slot+".json",1);
  print("stopped");
 }
};
