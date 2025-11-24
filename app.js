/*************** CONFIG ***************/
const API_BASE = "https://script.google.com/macros/s/AKfycbw5DMgrN-uG_FzPyn83P8SIg9E37BLipNTwnC5mEy2RyS_CIPTj_3XiOE-y5TahZDKP/exec";

/*************** STATE ***************/
let actor = null;
let tasks = [];
let isLoading = false;
let autoTimer = null;

/*************** JSONP Helper (append to HEAD, not BODY) ***************/
function jsonp(action, params = {}) {
  return new Promise((resolve, reject) => {
    const cb = "cb_" + Math.random().toString(36).slice(2);
    params.action = action;
    params.callback = cb;
    const qs = new URLSearchParams(params).toString();
    const url = API_BASE + "?" + qs;

    const script = document.createElement("script");

    window[cb] = (data) => {
      delete window[cb];
      script.remove();
      resolve(data);
    };

    script.src = url;
    script.async = true;
    script.onerror = () => {
      delete window[cb];
      script.remove();
      reject(new Error("JSONP load error"));
    };

    // 用 head 更稳，避免 body 为空时报错
    document.head.appendChild(script);
  });
}

/*************** LOGIN ***************/
async function ensureLogin(){
  let email = localStorage.getItem("jm_user_email") || "";
  if (!email){
    email = prompt("Please enter your company email (xxx@cloverth.net):")?.trim().toLowerCase() || "";
  }
  if (!email) throw new Error("No email");

  const res = await jsonp("login", { email });
  if (!res.ok) {
    localStorage.removeItem("jm_user_email");
    alert("Login failed: " + res.error);
    throw new Error(res.error);
  }

  actor = res;
  localStorage.setItem("jm_user_email", actor.email);
  document.getElementById("userPill").textContent = actor.email + (actor.admin ? " (admin)" : "");
  document.getElementById("logoutBtn").style.display = "";
}

/*************** LOAD TASKS (anti-overlap) ***************/
async function loadTasks(){
  if (!actor || isLoading) return;
  isLoading = true;
  try{
    const res = await jsonp("listTasks", { email: actor.email });
    if (!res.ok) throw new Error(res.error);

    tasks = res.tasks || [];
    render();
  }catch(e){
    console.error(e);
    alert("Load tasks error: " + e.message);
  }finally{
    isLoading = false;
  }
}

/*************** RENDER ***************/
function render(){
  const todo = tasks.filter(t => t.status==="To Do");
  const doing = tasks.filter(t => t.status==="Doing");
  const done = tasks.filter(t => t.status==="Done" || t.status==="Approved");

  setCol("todoCards", todo);
  setCol("doingCards", doing);
  setCol("doneCards", done);

  document.getElementById("c_todo").textContent = todo.length;
  document.getElementById("c_doing").textContent = doing.length;
  document.getElementById("c_done").textContent = done.length;
}

function setCol(id, list){
  const el = document.getElementById(id);
  el.innerHTML = "";
  list.forEach(t => el.appendChild(cardEl(t)));
}

function cardEl(t){
  const card = document.createElement("div");
  card.className="card";
  card.draggable = true;
  card.dataset.id = t.id;

  card.innerHTML = `
    <h4>${escapeHtml(t.title||"(No title)")}</h4>
    <div class="desc">${escapeHtml(t.description||"")}</div>
    <div class="meta">
      <span class="tag">@${escapeHtml(t.assigneeName||t.assigneeEmail||"")}</span>
      <span class="tag priority ${t.priority}">${t.priority||"Normal"}</span>
      <span class="tag">Due: ${fmtDate(t.dueDate)}</span>
      <span class="tag">By: ${escapeHtml(t.creatorEmail||"")}</span>
    </div>
    <div class="links">
      ${t.link1 ? `<a target="_blank" href="${t.link1}">Link1</a> `:""}
      ${t.link2 ? `<a target="_blank" href="${t.link2}">Link2</a> `:""}
      ${t.link3 ? `<a target="_blank" href="${t.link3}">Link3</a> `:""}
    </div>
    <div class="card-actions">
      <div style="display:flex;gap:6px;align-items:center;">
        <select class="statusSel">
          ${["To Do","Doing","Done","Approved"].map(s=>`<option ${t.status===s?"selected":""}>${s}</option>`).join("")}
        </select>
        ${canEditTask(t) ? `<button class="ghost editBtn">Edit</button>`:""}
      </div>
      <div style="display:flex;gap:6px;">
        <button class="ghost detailBtn">Detail</button>
        ${canArchiveTask(t) ? `<button class="ghost archiveBtn">Archive</button>`:""}
      </div>
    </div>
  `;

  // status change
  card.querySelector(".statusSel").addEventListener("change", async (e)=>{
    const newStatus = e.target.value;

    if (newStatus==="Approved" && !canApprove(t)) {
      alert("Only creator/admin can approve.");
      e.target.value = t.status;
      return;
    }

    try{
      if (newStatus==="Doing" && t.status==="Done" && canApprove(t)) {
        const reason = prompt("Reason to return to Doing?") || "";
        await jsonp("returnToDoing", { actorEmail: actor.email, id: t.id, reason });
      } else {
        await jsonp("moveTask", { actorEmail: actor.email, id: t.id, status: newStatus });
      }
      await loadTasks();
    }catch(err){
      alert(err.message);
      e.target.value = t.status;
    }
  });

  const editBtn = card.querySelector(".editBtn");
  if (editBtn) editBtn.addEventListener("click", ()=> openEdit(t));

  card.querySelector(".detailBtn").addEventListener("click", ()=> openDetail(t));

  const archiveBtn = card.querySelector(".archiveBtn");
  if (archiveBtn) archiveBtn.addEventListener("click", async ()=>{
    if (!confirm("Archive this task?")) return;
    await jsonp("archiveTask", { actorEmail: actor.email, id: t.id });
    await loadTasks();
  });

  // drag
  card.addEventListener("dragstart", (ev)=>{
    ev.dataTransfer.setData("text/plain", t.id);
  });

  return card;
}

/*************** PERMISSIONS ***************/
function canEditTask(t){
  if (actor.admin) return true;
  const ae = (t.assigneeEmail||"").toLowerCase();
  const ce = (t.creatorEmail||"").toLowerCase();
  return actor.email===ae || actor.email===ce;
}
function canArchiveTask(t){
  if (actor.admin) return true;
  return actor.email === (t.creatorEmail||"").toLowerCase();
}
function canApprove(t){
  if (actor.admin) return true;
  return actor.email === (t.creatorEmail||"").toLowerCase();
}

/*************** MODALS ***************/
function openModal(html){
  const bd = document.getElementById("backdrop");
  const m = document.getElementById("modal");
  m.innerHTML = html;
  bd.style.display="flex";
}
function closeModal(){
  document.getElementById("backdrop").style.display="none";
}

function openCreate(){
  openModal(renderTaskForm({mode:"create"}));
  bindForm({mode:"create"});
}

function openEdit(t){
  openModal(renderTaskForm({mode:"edit", task:t}));
  bindForm({mode:"edit", task:t});
}

async function openDetail(t){
  const cr = await jsonp("listComments",{taskId:t.id});
  const comments = cr.comments||[];

  openModal(`
    <h3>Task detail</h3>
    <div class="field"><label>Title</label><div>${escapeHtml(t.title||"")}</div></div>
    <div class="field"><label>Description</label><div style="white-space:pre-wrap">${escapeHtml(t.description||"")}</div></div>
    <div class="field"><label>Assignee</label><div>${escapeHtml(t.assigneeName||"")} (${escapeHtml(t.assigneeEmail||"")})</div></div>
    <div class="field"><label>Priority</label><div>${escapeHtml(t.priority||"Normal")}</div></div>
    <div class="field"><label>Status</label><div>${escapeHtml(t.status||"")}</div></div>
    <div class="field"><label>Due date</label><div>${fmtDate(t.dueDate)}</div></div>
    <div class="field"><label>Links</label>
      <div class="links">
        ${t.link1?`<a target="_blank" href="${t.link1}">${t.link1}</a><br>`:""}
        ${t.link2?`<a target="_blank" href="${t.link2}">${t.link2}</a><br>`:""}
        ${t.link3?`<a target="_blank" href="${t.link3}">${t.link3}</a><br>`:""}
      </div>
    </div>

    <div class="comment">
      <h4 style="margin:0 0 6px 0;">Comments</h4>
      <div id="cList">
        ${
          comments.map(c=>{
            const text = c.text ?? c.comment ?? "";
            const author = c.authorEmail ?? c.author ?? c.authorName ?? "";
            const when = c.createdAt || c.ts || "";
            return `
              <div class="citem">
                <div>${escapeHtml(text)}</div>
                <div class="cmeta">${escapeHtml(author)} · ${fmtDateTime(when)}</div>
              </div>
            `;
          }).join("")
          || `<div class="cmeta">No comments yet.</div>`
        }
      </div>
      <div class="comment-box">
        <input id="cInput" placeholder="Write a comment..."/>
        <button id="cSend" class="primary">Send</button>
      </div>
    </div>

    <div class="modal-actions">
      ${canApprove(t) && t.status==="Done" ? `
        <button id="approveBtn" class="primary">Approve</button>
        <button id="returnBtn">Return to Doing</button>
      `:""}
      <button onclick="closeModal()">Close</button>
    </div>
  `);

  document.getElementById("cSend").addEventListener("click", async ()=>{
    const text = document.getElementById("cInput").value.trim();
    if (!text) return;
    await jsonp("addComment",{actorEmail:actor.email, taskId:t.id, text});
    await openDetail(t); // reload detail
  });

  const approveBtn = document.getElementById("approveBtn");
  if (approveBtn) approveBtn.addEventListener("click", async ()=>{
    await jsonp("approve",{actorEmail:actor.email, id:t.id});
    closeModal(); await loadTasks();
  });

  const returnBtn = document.getElementById("returnBtn");
  if (returnBtn) returnBtn.addEventListener("click", async ()=>{
    const reason = prompt("Reason to return to Doing?") || "";
    await jsonp("returnToDoing",{actorEmail:actor.email, id:t.id, reason});
    closeModal(); await loadTasks();
  });
}

function renderTaskForm({mode, task={}}){
  const t = task;
  return `
    <h3>${mode==="create"?"Create task":"Edit task"}</h3>
    <div class="grid">
      <div class="field">
        <label>Title</label>
        <input id="f_title" value="${escapeAttr(t.title||"")}" placeholder="e.g. Follow up client A2-"/>
      </div>
      <div class="field">
        <label>Assignee (name)</label>
        <input id="f_assigneeName" value="${escapeAttr(t.assigneeName||"")}" placeholder="e.g. Lita"/>
      </div>

      <div class="field">
        <label>Assignee (email)</label>
        <input id="f_assigneeEmail" value="${escapeAttr(t.assigneeEmail||"")}" placeholder="xxx@cloverth.net"/>
      </div>
      <div class="field">
        <label>Priority</label>
        <select id="f_priority">
          ${["Urgent","Planned","Normal"].map(p=>`<option ${t.priority===p?"selected":""}>${p}</option>`).join("")}
        </select>
      </div>

      <div class="field">
        <label>Due date (required)</label>
        <input id="f_dueDate" type="date" value="${t.dueDate?toInputDate(t.dueDate):""}"/>
      </div>
      <div class="field">
        <label>Status</label>
        <select id="f_status">
          ${["To Do","Doing","Done","Approved"].map(s=>`<option ${t.status===s?"selected":""}>${s}</option>`).join("")}
        </select>
      </div>
    </div>

    <div class="field" style="margin-top:8px;">
      <label>Description (visible to assignee + creator)</label>
      <textarea id="f_description" placeholder="Details...">${escapeHtml(t.description||"")}</textarea>
    </div>

    <div class="grid" style="margin-top:8px;">
      <div class="field">
        <label>Link 1</label>
        <input id="f_link1" value="${escapeAttr(t.link1||"")}"/>
      </div>
      <div class="field">
        <label>Link 2</label>
        <input id="f_link2" value="${escapeAttr(t.link2||"")}"/>
      </div>
      <div class="field">
        <label>Link 3</label>
        <input id="f_link3" value="${escapeAttr(t.link3||"")}"/>
      </div>
    </div>

    <div class="modal-actions">
      <button onclick="closeModal()">Cancel</button>
      <button id="saveBtn" class="primary">Save</button>
    </div>
  `;
}

function bindForm({mode, task={}}){
  const saveBtn = document.getElementById("saveBtn");

  saveBtn.addEventListener("click", async ()=>{
    if (saveBtn.disabled) return; // 防止双击导致重复任务
    saveBtn.disabled = true;

    try{
      const title = document.getElementById("f_title").value.trim();
      const assigneeName = document.getElementById("f_assigneeName").value.trim();
      const assigneeEmail = document.getElementById("f_assigneeEmail").value.trim().toLowerCase();
      const priority = document.getElementById("f_priority").value;
      const status = document.getElementById("f_status").value;
      const dueDate = document.getElementById("f_dueDate").value;
      const description = document.getElementById("f_description").value.trim();
      const link1 = document.getElementById("f_link1").value.trim();
      const link2 = document.getElementById("f_link2").value.trim();
      const link3 = document.getElementById("f_link3").value.trim();

      if (!title) return alert("Title required");
      if (!assigneeEmail.endsWith("@cloverth.net")) return alert("Assignee must be cloverth email");
      if (!dueDate) return alert("Due date required");

      if (mode==="create"){
        const res = await jsonp("createTask", {
          actorEmail: actor.email,
          title, description, assigneeName, assigneeEmail,
          priority, status,
          dueDate,
          link1, link2, link3
        });
        if (!res.ok) return alert(res.error);
      } else {
        const res = await jsonp("updateTask", {
          actorEmail: actor.email,
          id: task.id,
          title, description, assigneeName, assigneeEmail,
          priority, status,
          dueDate,
          link1, link2, link3
        });
        if (!res.ok) return alert(res.error);
      }

      closeModal();
      await loadTasks();
    } finally {
      saveBtn.disabled = false;
    }
  });
}

/*************** DRAG DROP ***************/
document.querySelectorAll(".col").forEach(col=>{
  col.addEventListener("dragover", e=>e.preventDefault());
  col.addEventListener("drop", async e=>{
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    const status = col.dataset.status;
    await jsonp("moveTask",{actorEmail:actor.email, id, status});
    await loadTasks();
  });
});

/*************** UTIL ***************/
function fmtDate(d){
  if (!d) return "-";
  try{ return new Date(d).toISOString().slice(0,10); }catch{ return d; }
}
function fmtDateTime(d){
  if (!d) return "-";
  try{ return new Date(d).toLocaleString(); }catch{ return d; }
}
function toInputDate(d){
  try{ return new Date(d).toISOString().slice(0,10); }catch{ return ""; }
}
function escapeHtml(s){
  s = String(s||"");
  return s.replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
}
function escapeAttr(s){ return escapeHtml(s).replace(/"/g,"&quot;"); }

/*************** INIT ***************/
window.addEventListener("DOMContentLoaded", async ()=>{
  try{
    await ensureLogin();
    await loadTasks();
  }catch(err){
    console.error(err);
    alert("Init error: " + err.message);
  }

  document.getElementById("addBtn").addEventListener("click", openCreate);
  document.getElementById("refreshBtn").addEventListener("click", loadTasks);

  document.getElementById("logoutBtn").addEventListener("click", ()=>{
    localStorage.removeItem("jm_user_email");
    location.reload();
  });

  // auto refresh every 60s, but avoid stacking
  autoTimer = setInterval(()=>{
    if (!isLoading) loadTasks();
  }, 60000);
});
