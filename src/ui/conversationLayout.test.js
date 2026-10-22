"use strict";
const fs=require("fs");
const path=require("path");
const html=fs.readFileSync(path.join(__dirname,"../../public/index.html"),"utf8");
test("welcome choices are presented as the assistant's own chat content",()=>{
 expect(html).toMatch(/id="messages"[\s\S]*class="message assistant welcome-message"[\s\S]*id="suggestions"/);
 expect(html).toMatch(/const reply = addMessage\(data.answer, "assistant"\);\s*reply.appendChild\(assistantActions\)/);
 expect((html.match(/id="messages"/g)||[]).length).toBe(1);
});
test("followup form lives in transcript and stays hidden until requested",()=>{
 expect(html).toMatch(/id="messages"[\s\S]*id="contactIntake"[^>]*hidden/);
 expect(html).toContain('id="contactIntakeTurn" class="chat-turn assistant" hidden');
 expect(html).toContain("messages.appendChild(contactIntakeTurn)");
 expect(html).toContain('contactIntakeTurn.hidden = false');
 expect(html).toContain('contactIntake.hidden = false');
 expect(html).toContain('followUpJump.hidden = false');
 expect(html).toContain('contactIntake.hidden = true');
 expect(html).toContain('contactIntakeTurn.hidden = true');
 expect(html).toContain("messages.appendChild(showingNextTurn)");
});
test("real inquiries keep explicit consent, verification and privacy controls",()=>{
 for(const item of ["name=\"recording\" required","name=\"emailConsent\"",
  'id="humanVerification"','id="privacyLink"',"turnstile.getResponse","turnstileToken"])
  expect(html).toContain(item);
 expect(html).toContain('name="phone" type="hidden" value=""');
 expect(html).toContain('name="preferredChannel" type="hidden" value="email"');
 expect(html).toMatch(/\[hidden\] \{ display: none !important; \}/);
});

test("assistant and visitor display distinct branded/decorative avatars",()=>{
 expect(html).toContain('class="chat-avatar assistant"');
 expect(html).toContain('logo.src = "/assets/brand/logo-mark-64.png"');
 expect(html).toContain('createTurn(role, div)');
 expect(html).toContain('document.createElementNS("http://www.w3.org/2000/svg", "svg")');
 expect(html).toContain('turn.className = "chat-turn " + role');
});
test("thinking dots appear during request and are removed on success or failure",()=>{
 expect(html).toContain("const typingTurn = addTypingIndicator()");
 expect(html).toMatch(/finally\s*\{\s*typingTurn\.remove\(\)/);
 expect(html).toContain('bubble.setAttribute("role", "status")');
 expect(html).toContain("prefers-reduced-motion: reduce");
 expect(html).toContain("animation: typing-pulse");
});
