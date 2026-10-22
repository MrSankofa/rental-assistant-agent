"use strict";
// Best-effort in-process safety valve, NOT distributed edge protection.
class LocalAbuseGuard {
 constructor({windowMs=900000,maxRequests=30,maxKeys=2000,maxInFlight=8,maxTotal=2500,now=Date.now}={}){
  this.windowMs=windowMs;this.maxRequests=maxRequests;this.maxKeys=maxKeys;
  this.maxInFlight=maxInFlight;this.maxTotal=maxTotal;this.now=now;
  this.buckets=new Map();this.active=0;this.windowStart=now();this.total=0;
 }
 allow(key){
  const now=this.now();
  if(now-this.windowStart>=this.windowMs){this.windowStart=now;this.total=0;this.buckets.clear();}
  if(this.total>=this.maxTotal)return false;
  const previous=this.buckets.get(key);
  if(previous&&previous.count>=this.maxRequests)return false;
  if(!previous&&this.buckets.size>=this.maxKeys){
   const oldest=this.buckets.keys().next().value;
   this.buckets.delete(oldest);
  }
  this.buckets.delete(key);
  this.buckets.set(key,{count:(previous?.count||0)+1});
  this.total++;
  return true;
 }
 enter(){if(this.active>=this.maxInFlight)return false;this.active++;return true;}
 leave(){this.active=Math.max(0,this.active-1);}
}
function peerIdentity(req){
 // Peer address is not a real visitor IP behind Cloud Run proxy.
 // Intentionally ignore spoofable forwarding headers and use global ceiling.
 return req.socket?.remoteAddress||"unknown";
}
module.exports={LocalAbuseGuard,peerIdentity};
