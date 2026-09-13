import express from "express";
import path from "path";
import {fileURLToPath} from "url";
import admin from "firebase-admin";

const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);

let serviceAccount;
try {
  serviceAccount=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "{}");
} catch(e) {
  throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.");
}
if(!serviceAccount.project_id){
  console.warn("Firebase Admin credentials are missing. Set FIREBASE_SERVICE_ACCOUNT_JSON on Render.");
}
if(!admin.apps.length && serviceAccount.project_id){
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL || "https://app-arbooks-default-rtdb.firebaseio.com"
  });
}
const db=()=>admin.database();

const app=express();
app.use(express.json({limit:"1mb"}));
app.use(express.static(path.join(__dirname,"public")));

async function auth(req,res,next){
  try{
    const h=req.headers.authorization||"";
    if(!h.startsWith("Bearer ")) return res.status(401).json({error:"Login required"});
    req.user=await admin.auth().verifyIdToken(h.slice(7));
    next();
  }catch(e){res.status(401).json({error:"Invalid or expired login session"});}
}
function adminOnly(req,res,next){
  const emails=(process.env.ADMIN_EMAILS||"").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
  if(!req.user?.email || !emails.includes(req.user.email.toLowerCase()))
    return res.status(403).json({error:"Admin access denied"});
  next();
}
const clean=(v,max=200)=>String(v??"").trim().slice(0,max);
const num=v=>Number(v);

app.get("/api/health",(req,res)=>res.json({ok:true,version:"2.0.0"}));

app.post("/api/profile",auth,async(req,res)=>{
  const name=clean(req.body.name,80);
  if(!name) return res.status(400).json({error:"Name is required"});
  const uid=req.user.uid;
  const userRef=db().ref(`users/${uid}`);
  const snap=await userRef.get();
  const old=snap.val()||{};
  await userRef.update({uid,name,email:req.user.email||old.email||"",updatedAt:Date.now()});
  res.json({ok:true});
});

app.get("/api/me",auth,async(req,res)=>{
  const snap=await db().ref(`users/${req.user.uid}`).get();
  res.json({uid:req.user.uid,email:req.user.email,user:snap.val()||null});
});

app.get("/api/tasks",auth,async(req,res)=>{
  const snap=await db().ref("tasks").get();
  const tasks=snap.val()||{};
  res.json(Object.entries(tasks).map(([id,t])=>({id,...t})).filter(t=>t.active!==false));
});

app.post("/api/tasks/:id/claim",auth,async(req,res)=>{
  const uid=req.user.uid, id=clean(req.params.id,100);
  const taskSnap=await db().ref(`tasks/${id}`).get();
  if(!taskSnap.exists()) return res.status(404).json({error:"Task not found"});
  const task=taskSnap.val();
  if(task.active===false) return res.status(400).json({error:"Task is inactive"});
  const claimRef=db().ref(`taskClaims/${uid}/${id}`);
  if((await claimRef.get()).exists()) return res.status(409).json({error:"Already submitted"});
  await claimRef.set({taskId:id,title:clean(task.title,120),reward:num(task.reward)||0,status:"pending",createdAt:Date.now()});
  res.json({ok:true});
});

app.get("/api/transactions",auth,async(req,res)=>{
  const snap=await db().ref(`transactions/${req.user.uid}`).get();
  const data=snap.val()||{};
  res.json(Object.entries(data).map(([id,t])=>({id,...t})).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)));
});

app.post("/api/transactions",auth,async(req,res)=>{
  const type=clean(req.body.type,20);
  const amount=num(req.body.amount);
  const method=clean(req.body.method,40);
  const reference=clean(req.body.reference,100);
  if(!["deposit","withdraw"].includes(type)) return res.status(400).json({error:"Invalid transaction type"});
  if(!Number.isFinite(amount)||amount<=0) return res.status(400).json({error:"Invalid amount"});
  if(type==="withdraw" && !method) return res.status(400).json({error:"Payment method is required"});
  const userSnap=await db().ref(`users/${req.user.uid}`).get();
  const user=userSnap.val()||{};
  if(user.status==="blocked") return res.status(403).json({error:"Account is blocked"});
  if(type==="withdraw" && amount>num(user.balance||0)) return res.status(400).json({error:"Insufficient balance"});
  const txRef=db().ref(`transactions/${req.user.uid}`).push();
  await txRef.set({type,amount,method,reference,status:"pending",createdAt:Date.now()});
  res.json({ok:true,id:txRef.key});
});

app.get("/api/referral",auth,async(req,res)=>{
  const snap=await db().ref(`users/${req.user.uid}`).get();
  const u=snap.val()||{};
  res.json({code:u.referralCode||req.user.uid.slice(0,8).toUpperCase(),count:0,earnings:0});
});

/* Admin APIs */
app.get("/api/admin/users",auth,adminOnly,async(req,res)=>{
  const snap=await db().ref("users").get(), data=snap.val()||{};
  res.json(Object.entries(data).map(([uid,u])=>({uid,...u})));
});
app.patch("/api/admin/users/:uid",auth,adminOnly,async(req,res)=>{
  const uid=clean(req.params.uid,200);
  const patch={};
  if(req.body.status) patch.status=clean(req.body.status,20);
  if(req.body.balance!==undefined){
    const b=num(req.body.balance);
    if(!Number.isFinite(b)||b<0) return res.status(400).json({error:"Invalid balance"});
    patch.balance=b;
  }
  if(req.body.verified!==undefined) patch.verified=!!req.body.verified;
  if(req.body.role) patch.role=clean(req.body.role,20);
  await db().ref(`users/${uid}`).update(patch);
  res.json({ok:true});
});
app.get("/api/admin/transactions",auth,adminOnly,async(req,res)=>{
  const snap=await db().ref("transactions").get(), root=snap.val()||{};
  const out=[];
  for(const [uid,txs] of Object.entries(root))
    for(const [id,t] of Object.entries(txs||{})) out.push({uid,id,...t});
  out.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  res.json(out);
});
app.patch("/api/admin/transactions/:uid/:id",auth,adminOnly,async(req,res)=>{
  const uid=clean(req.params.uid,200), id=clean(req.params.id,200), action=clean(req.body.action,20);
  const txRef=db().ref(`transactions/${uid}/${id}`);
  const txSnap=await txRef.get();
  if(!txSnap.exists()) return res.status(404).json({error:"Transaction not found"});
  const tx=txSnap.val();
  if(tx.status!=="pending") return res.status(409).json({error:"Transaction already reviewed"});
  if(!["approved","rejected"].includes(action)) return res.status(400).json({error:"Invalid action"});
  const userRef=db().ref(`users/${uid}`);
  const userSnap=await userRef.get(), user=userSnap.val()||{};
  if(action==="approved"){
    let balance=num(user.balance||0);
    if(tx.type==="deposit") balance+=num(tx.amount);
    if(tx.type==="withdraw"){
      if(balance<num(tx.amount)) return res.status(400).json({error:"User balance is insufficient"});
      balance-=num(tx.amount);
    }
    await userRef.update({balance});
  }
  await txRef.update({status:action,reviewedAt:Date.now(),reviewedBy:req.user.email});
  res.json({ok:true});
});
app.get("/api/admin/task-claims",auth,adminOnly,async(req,res)=>{
  const snap=await db().ref("taskClaims").get(), root=snap.val()||{}, out=[];
  for(const [uid,claims] of Object.entries(root))
    for(const [id,c] of Object.entries(claims||{})) out.push({uid,id,...c});
  out.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  res.json(out);
});
app.patch("/api/admin/task-claims/:uid/:id",auth,adminOnly,async(req,res)=>{
  const uid=clean(req.params.uid,200), id=clean(req.params.id,200), action=clean(req.body.action,20);
  const cRef=db().ref(`taskClaims/${uid}/${id}`), s=await cRef.get();
  if(!s.exists()) return res.status(404).json({error:"Claim not found"});
  const c=s.val();
  if(c.status!=="pending") return res.status(409).json({error:"Already reviewed"});
  if(!["approved","rejected"].includes(action)) return res.status(400).json({error:"Invalid action"});
  if(action==="approved"){
    const uRef=db().ref(`users/${uid}`), us=await uRef.get(), u=us.val()||{};
    await uRef.update({balance:num(u.balance||0)+num(c.reward||0)});
  }
  await cRef.update({status:action,reviewedAt:Date.now(),reviewedBy:req.user.email});
  res.json({ok:true});
});

app.use((req,res)=>{
  if(req.method==="GET") return res.sendFile(path.join(__dirname,"public","index.html"));
  res.status(404).json({error:"Not found"});
});
const port=process.env.PORT||3000;
app.listen(port,()=>console.log(`RMI BD V2 running on ${port}`));
