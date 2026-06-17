import * as THREE from '/vendor/three.module.js';

const state = {
  me: null,
  socket: null,
  users: [],
  onlineUserIds: new Set(),
  room: null,
  queued: false,
  keys: { up: false, down: false },
  sceneReady: false
};

const el = {
  authView: document.querySelector('#authView'),
  appView: document.querySelector('#appView'),
  sessionLine: document.querySelector('#sessionLine'),
  notice: document.querySelector('#notice'),
  socketStatus: document.querySelector('#socketStatus'),
  headerAvatar: document.querySelector('#headerAvatar'),
  profileMenuButton: document.querySelector('#profileMenuButton'),
  securityMenuButton: document.querySelector('#securityMenuButton'),
  logoutButton: document.querySelector('#logoutButton'),
  profileModal: document.querySelector('#profileModal'),
  profileModalBackdrop: document.querySelector('#profileModalBackdrop'),
  closeProfileButton: document.querySelector('#closeProfileButton'),
  securityModal: document.querySelector('#securityModal'),
  securityModalBackdrop: document.querySelector('#securityModalBackdrop'),
  closeSecurityButton: document.querySelector('#closeSecurityButton'),
  registerForm: document.querySelector('#registerForm'),
  loginForm: document.querySelector('#loginForm'),
  secondFactorForm: document.querySelector('#secondFactorForm'),
  challengeToken: document.querySelector('#challengeToken'),
  reauthForm: document.querySelector('#reauthForm'),
  start2faButton: document.querySelector('#start2faButton'),
  disable2faButton: document.querySelector('#disable2faButton'),
  regenRecoveryButton: document.querySelector('#regenRecoveryButton'),
  provisioningUri: document.querySelector('#provisioningUri'),
  manualSecret: document.querySelector('#manualSecret'),
  confirm2faForm: document.querySelector('#confirm2faForm'),
  recoveryCodes: document.querySelector('#recoveryCodes'),
  passwordForm: document.querySelector('#passwordForm'),
  unlink42Button: document.querySelector('#unlink42Button'),
  profileForm: document.querySelector('#profileForm'),
  avatarFile: document.querySelector('#avatarFile'),
  avatarPreview: document.querySelector('#avatarPreview'),
  chatForm: document.querySelector('#chatForm'),
  chatLog: document.querySelector('#chatLog'),
  usersList: document.querySelector('#usersList'),
  leaderboardList: document.querySelector('#leaderboardList'),
  historyList: document.querySelector('#historyList'),
  statsBox: document.querySelector('#statsBox'),
  queueButton: document.querySelector('#queueButton'),
  botDifficulty: document.querySelector('#botDifficulty'),
  roomLabel: document.querySelector('#roomLabel'),
  gameState: document.querySelector('#gameState'),
  scoreBox: document.querySelector('#scoreBox'),
  goalBanner: document.querySelector('#goalBanner'),
  gameCanvas: document.querySelector('#gameCanvas'),
  upButton: document.querySelector('#upButton'),
  downButton: document.querySelector('#downButton')
};

const usernameSeed = `player${Math.floor(100000 + Math.random() * 900000)}`;
el.registerForm.username.value = usernameSeed;
el.registerForm.email.value = `${usernameSeed}@example.com`;
el.loginForm.username.value = usernameSeed;

const AVATAR_MAX_BYTES = 256 * 1024;
const AVATAR_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif']);

async function api(path, options = {}) {
  const hasBody = options.body !== undefined;
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: hasBody ? { 'Content-Type': 'application/json', ...(options.headers ?? {}) } : options.headers,
    ...options,
    body: hasBody ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.message ?? 'Request failed');
  return data;
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function notify(message, mode = 'ok') {
  el.notice.textContent = message;
  el.notice.classList.remove('hidden', 'error');
  if (mode === 'error') el.notice.classList.add('error');
}

function clearNotice() {
  el.notice.textContent = '';
  el.notice.classList.add('hidden');
  el.notice.classList.remove('error');
}

function errorMessage(error) {
  return error instanceof Error ? error.message : 'Unexpected error';
}

function showApp(user) {
  state.me = user;
  el.authView.classList.add('hidden');
  el.appView.classList.remove('hidden');
  el.logoutButton.classList.remove('hidden');
  el.profileMenuButton.classList.remove('hidden');
  el.securityMenuButton.classList.remove('hidden');
  el.headerAvatar.classList.remove('hidden');
  el.sessionLine.textContent = `Signed in as ${user.displayName || user.username}`;
  el.profileForm.displayName.value = user.displayName ?? '';
  el.profileForm.avatarUrl.value = user.avatarUrl ?? '';
  el.profileForm.bio.value = user.bio ?? '';
  renderAvatarPreview(user.avatarUrl);
  renderHeaderAvatar(user);
  connectSocket();
  refreshDashboard().catch((error) => notify(errorMessage(error), 'error'));
}

function showAuth() {
  state.me = null;
  el.authView.classList.remove('hidden');
  el.appView.classList.add('hidden');
  el.logoutButton.classList.add('hidden');
  el.profileMenuButton.classList.add('hidden');
  el.securityMenuButton.classList.add('hidden');
  el.headerAvatar.classList.add('hidden');
  closeProfileModal();
  closeSecurityModal();
  el.sessionLine.textContent = 'Sign in to play';
  setSocketStatus(false);
}

function setSocketStatus(online) {
  el.socketStatus.textContent = online ? 'Online' : 'Offline';
  el.socketStatus.classList.toggle('online', online);
}

function connectSocket() {
  if (state.socket && state.socket.readyState <= WebSocket.OPEN) return;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  state.socket = new WebSocket(`${protocol}//${location.host}/ws`);
  state.socket.addEventListener('open', () => {
    setSocketStatus(true);
    notify('Connected. You can chat or find a match.');
  });
  state.socket.addEventListener('close', () => {
    setSocketStatus(false);
    if (state.me) {
      notify('Connection lost. Reconnecting...', 'error');
      setTimeout(connectSocket, 1200);
    }
  });
  state.socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    handleLiveMessage(message.type, message.payload);
  });
}

function sendLive(type, payload = {}) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    notify('Live connection is not ready yet. Wait a second and try again.', 'error');
    return false;
  }
  state.socket.send(JSON.stringify({ type, payload }));
  return true;
}

function handleLiveMessage(type, payload) {
  if (type === 'session:ready') {
    state.onlineUserIds = new Set(payload.onlineUserIds);
    if (payload.room) updateRoom(payload.room);
    renderUsers();
  }
  if (type === 'presence:update') {
    state.onlineUserIds = new Set(payload.onlineUserIds);
    renderUsers();
  }
  if (type === 'chat:message') addChatMessage(payload.message);
  if (type === 'chat:typing') el.gameState.textContent = 'A player is typing in chat';
  if (type === 'chat:invite') addSystemMessage(`${nameFor(payload.fromUserId)} invited you to play`);
  if (type === 'queue:update') {
    state.queued = payload.queued;
    el.queueButton.textContent = state.queued ? 'Cancel search' : 'Find match';
    el.gameState.textContent = payload.botFallbackSeconds
      ? `Searching for an opponent. Bot starts in ${payload.botFallbackSeconds}s`
      : state.queued
        ? 'Searching for an opponent'
        : 'No active match';
  }
  if (type === 'game:start' || type === 'game:state' || type === 'game:finished') updateRoom(payload);
  if (type === 'game:pause') el.gameState.textContent = `${nameFor(payload.userId)} disconnected`;
  if (type === 'game:resume') el.gameState.textContent = `${nameFor(payload.userId)} reconnected`;
  if (type === 'game:finished') refreshDashboard();
}

function updateRoom(room) {
  const previousScores = state.room?.scores ?? null;
  state.room = room;
  state.queued = false;
  el.queueButton.textContent = 'Find match';
  el.roomLabel.textContent = room ? `Room ${room.id.slice(-6)}` : 'Lobby';
  el.gameState.textContent = room?.status === 'finished' ? 'Match finished' : 'Match in progress';
  const [left, right] = room.players;
  el.scoreBox.textContent = `${room.scores[left] ?? 0} : ${room.scores[right] ?? 0}`;
  if (previousScores) {
    const scorerId = room.scores[left] > (previousScores[left] ?? 0) ? left : room.scores[right] > (previousScores[right] ?? 0) ? right : null;
    if (scorerId) showGoalMessage(scorerId);
  }
  syncScene(room);
}

function showGoalMessage(scorerId) {
  const label = scorerId === state.me?.id ? 'Goal for you' : `Goal for ${nameFor(scorerId)}`;
  el.goalBanner.textContent = `${label}!`;
  el.goalBanner.classList.remove('hidden');
  el.goalBanner.style.animation = 'none';
  void el.goalBanner.offsetWidth;
  el.goalBanner.style.animation = '';
  table.material.emissive = new THREE.Color(0x0f766e);
  table.material.emissiveIntensity = 0.8;
  setTimeout(() => {
    el.goalBanner.classList.add('hidden');
    table.material.emissiveIntensity = 0;
  }, 900);
}

async function refreshDashboard() {
  if (!state.me) return;
  const [users, chat, stats, matches, leaderboard] = await Promise.all([
    api('/users'),
    api('/chat/messages'),
    api(`/users/${state.me.id}/stats`),
    api(`/users/${state.me.id}/matches`),
    api('/leaderboard')
  ]);
  state.users = users.users;
  state.onlineUserIds = new Set(state.users.filter((user) => user.online).map((user) => user.id));
  renderUsers();
  renderStats(stats.stats);
  renderHistory(matches.matches);
  renderLeaderboard(leaderboard.leaderboard);
  el.chatLog.innerHTML = '';
  chat.messages.reverse().forEach(addChatMessage);
}

function renderUsers() {
  el.usersList.innerHTML = '';
  for (const user of state.users) {
    const row = document.createElement('div');
    row.className = 'list-item player-row';
    row.innerHTML = `
      <div class="player-avatar">${avatarMarkup(user)}</div>
      <div>
        <strong>${escapeHtml(user.displayName || user.username)}</strong>
        <span>${user.online ? 'online' : 'offline'} · ${escapeHtml(user.bio || 'No bio')}</span>
        <div class="inline-actions">
          <button type="button" data-action="friend" data-user-id="${user.id}">Add</button>
          <button type="button" data-action="invite" data-user-id="${user.id}">Invite</button>
          <button type="button" data-action="block" data-user-id="${user.id}" class="secondary">Block</button>
        </div>
      </div>
    `;
    el.usersList.append(row);
  }
}

function renderStats(stats) {
  el.statsBox.innerHTML = '';
  const cards = [
    ['Wins', stats.wins],
    ['Losses', stats.losses],
    ['Win rate', `${stats.winRate}%`],
    ['Level', stats.level]
  ];
  for (const [label, value] of cards) {
    const card = document.createElement('div');
    card.className = 'stat-card';
    card.innerHTML = `<strong>${value}</strong><span>${label}</span>`;
    el.statsBox.append(card);
  }
}

function renderHistory(matches) {
  el.historyList.innerHTML = '';
  if (!matches.length) {
    el.historyList.innerHTML = '<div class="list-item"><span>No matches yet</span></div>';
    return;
  }
  for (const match of matches) {
    const me = match.players.find((player) => player.userId === state.me.id);
    const opponents = match.players.filter((player) => player.userId !== state.me.id);
    const row = document.createElement('div');
    row.className = 'list-item';
    row.innerHTML = `<strong>${match.winnerUserId === state.me.id ? 'Win' : 'Loss'} · ${me?.score ?? 0}-${opponents[0]?.score ?? 0}</strong><span>${new Date(match.finishedAt).toLocaleString()}</span>`;
    el.historyList.append(row);
  }
}

function renderLeaderboard(items) {
  el.leaderboardList.innerHTML = '';
  if (!items.length) {
    el.leaderboardList.innerHTML = '<div class="list-item"><span>No ranked matches yet</span></div>';
    return;
  }
  items.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'list-item';
    row.innerHTML = `<strong>#${index + 1} ${nameFor(item.userId)}</strong><span>${item.rankingPoints} pts · ${item.wins} wins</span>`;
    el.leaderboardList.append(row);
  });
}

function addChatMessage(message) {
  const row = document.createElement('div');
  row.className = 'chat-message';
  row.innerHTML = `<strong>${nameFor(message.authorUserId)}</strong><span>${new Date(message.createdAt).toLocaleTimeString()}</span><div>${escapeHtml(message.body)}</div>`;
  el.chatLog.append(row);
  el.chatLog.scrollTop = el.chatLog.scrollHeight;
}

function addSystemMessage(text) {
  const row = document.createElement('div');
  row.className = 'chat-message';
  row.innerHTML = `<strong>System</strong><div>${escapeHtml(text)}</div>`;
  el.chatLog.append(row);
  el.chatLog.scrollTop = el.chatLog.scrollHeight;
}

function nameFor(userId) {
  if (state.me?.id === userId) return state.me.displayName || state.me.username;
  const user = state.users.find((item) => item.id === userId);
  return user?.displayName || user?.username || userId.slice(0, 6);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
}

function avatarMarkup(user) {
  if (user.avatarUrl) return `<img src="${escapeHtml(user.avatarUrl)}" alt="">`;
  return escapeHtml((user.displayName || user.username || '?').slice(0, 1).toUpperCase());
}

el.registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearNotice();
  try {
    const body = formData(event.currentTarget);
    await api('/auth/register', { method: 'POST', body });
    await api('/auth/logout', { method: 'POST' });
    el.loginForm.username.value = body.username;
    notify('Account created. Use the login form to enter.');
  } catch (error) {
    notify(`Register failed: ${errorMessage(error)}`, 'error');
  }
});

el.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearNotice();
  try {
    const data = await api('/auth/login', { method: 'POST', body: formData(event.currentTarget) });
    if (data.status === 'requires_2fa') {
      el.challengeToken.value = data.challengeToken;
      el.secondFactorForm.classList.remove('hidden');
      notify('Second factor required.');
      return;
    }
    notify('Login completed.');
    showApp(data.user);
  } catch (error) {
    notify(`Login failed: ${errorMessage(error)}`, 'error');
  }
});

el.secondFactorForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await api('/auth/login/2fa', { method: 'POST', body: formData(event.currentTarget) });
    notify('Login completed.');
    showApp(data.user);
  } catch (error) {
    notify(`Second factor failed: ${errorMessage(error)}`, 'error');
  }
});

el.logoutButton.addEventListener('click', async () => {
  try {
    await api('/auth/logout', { method: 'POST' });
    state.socket?.close();
    showAuth();
    notify('Logged out.');
  } catch (error) {
    notify(`Logout failed: ${errorMessage(error)}`, 'error');
  }
});

el.profileMenuButton.addEventListener('click', () => {
  el.profileModal.classList.remove('hidden');
});

el.closeProfileButton.addEventListener('click', closeProfileModal);
el.profileModalBackdrop.addEventListener('click', closeProfileModal);

el.securityMenuButton.addEventListener('click', () => {
  el.securityModal.classList.remove('hidden');
});

el.closeSecurityButton.addEventListener('click', closeSecurityModal);
el.securityModalBackdrop.addEventListener('click', closeSecurityModal);

function closeProfileModal() {
  el.profileModal.classList.add('hidden');
}

function closeSecurityModal() {
  el.securityModal.classList.add('hidden');
}

el.avatarFile.addEventListener('change', async () => {
  const file = el.avatarFile.files?.[0];
  if (!file) return;
  if (!AVATAR_TYPES.has(file.type)) {
    el.avatarFile.value = '';
    notify('Avatar must be PNG, JPG or GIF.', 'error');
    return;
  }
  if (file.size > AVATAR_MAX_BYTES) {
    el.avatarFile.value = '';
    notify('Avatar is too large. Maximum size is 256 KB.', 'error');
    return;
  }
  const dataUrl = await readFileAsDataUrl(file);
  el.profileForm.avatarUrl.value = dataUrl;
  renderAvatarPreview(dataUrl);
  notify('Avatar selected. Save profile to apply it.');
});

el.profileForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const body = formData(event.currentTarget);
    delete body.avatarFile;
    const data = await api('/me/profile', { method: 'PATCH', body });
    state.me = data.user;
    await refreshDashboard();
    renderAvatarPreview(data.user.avatarUrl);
    renderHeaderAvatar(data.user);
    closeProfileModal();
    notify('Profile saved.');
  } catch (error) {
    notify(`Profile update failed: ${errorMessage(error)}`, 'error');
  }
});

el.reauthForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const body = formData(event.currentTarget);
  if (!body.secondFactorMethod) delete body.secondFactorMethod;
  if (!body.secondFactorCode) delete body.secondFactorCode;
  try {
    await api('/auth/reauthenticate', { method: 'POST', body });
    notify('Reauthentication completed. Sensitive actions are unlocked for a short time.');
  } catch (error) {
    notify(`Reauthentication failed: ${errorMessage(error)}`, 'error');
  }
});

el.start2faButton.addEventListener('click', async () => {
  try {
    const data = await api('/2fa/setup', { method: 'POST' });
    el.provisioningUri.value = data.provisioningUri;
    el.manualSecret.value = new URL(data.provisioningUri).searchParams.get('secret') ?? '';
    notify('2FA setup started. Scan the URI or use the manual secret, then confirm the code.');
  } catch (error) {
    notify(`2FA setup failed: ${errorMessage(error)}`, 'error');
  }
});

el.confirm2faForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await api('/2fa/confirm', { method: 'POST', body: formData(event.currentTarget) });
    el.recoveryCodes.textContent = data.recoveryCodes.join('\n');
    notify('2FA enabled. Save the recovery codes.');
  } catch (error) {
    notify(`2FA confirmation failed: ${errorMessage(error)}`, 'error');
  }
});

el.regenRecoveryButton.addEventListener('click', async () => {
  try {
    const data = await api('/2fa/recovery-codes/regenerate', { method: 'POST' });
    el.recoveryCodes.textContent = data.recoveryCodes.join('\n');
    notify('Recovery codes regenerated. Save them now.');
  } catch (error) {
    notify(`Recovery code regeneration failed: ${errorMessage(error)}`, 'error');
  }
});

el.disable2faButton.addEventListener('click', async () => {
  try {
    await api('/2fa', { method: 'DELETE' });
    el.provisioningUri.value = '';
    el.manualSecret.value = '';
    el.recoveryCodes.textContent = '2FA disabled.';
    notify('2FA disabled.');
  } catch (error) {
    notify(`Disable 2FA failed: ${errorMessage(error)}`, 'error');
  }
});

el.passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/auth/password/change', { method: 'POST', body: formData(event.currentTarget) });
    notify('Password changed. Other sessions were revoked.');
  } catch (error) {
    notify(`Password change failed: ${errorMessage(error)}`, 'error');
  }
});

el.unlink42Button.addEventListener('click', async () => {
  try {
    await api('/auth/oauth/42/link', { method: 'DELETE' });
    notify('42 account unlinked.');
  } catch (error) {
    notify(`Unlink 42 failed: ${errorMessage(error)}`, 'error');
  }
});

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result)));
    reader.addEventListener('error', () => reject(new Error('Could not read avatar file')));
    reader.readAsDataURL(file);
  });
}

function renderAvatarPreview(value) {
  el.avatarPreview.innerHTML = '';
  if (!value) {
    el.avatarPreview.textContent = 'No avatar';
    return;
  }
  const image = document.createElement('img');
  image.src = value;
  image.alt = 'Avatar preview';
  el.avatarPreview.append(image);
}

function renderHeaderAvatar(user) {
  el.headerAvatar.innerHTML = avatarMarkup(user);
}

el.chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const body = el.chatForm.body.value.trim();
  if (!body) return;
  sendLive('chat:send', { body });
  el.chatForm.reset();
});

el.chatForm.body.addEventListener('input', () => sendLive('chat:typing'));

el.queueButton.addEventListener('click', () => {
  const payload = state.queued ? {} : { botDifficulty: Number(el.botDifficulty.value) };
  if (sendLive(state.queued ? 'queue:leave' : 'queue:join', payload)) {
    notify(state.queued ? 'Leaving matchmaking.' : 'Searching match. A bot will join if no human is available.');
  }
});

el.usersList.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  const userId = button.dataset.userId;
  if (!userId || userId === state.me.id) return;
  try {
    if (button.dataset.action === 'friend') await api(`/users/${userId}/friends`, { method: 'POST' });
    if (button.dataset.action === 'invite') sendLive('chat:invite', { toUserId: userId });
    if (button.dataset.action === 'block') await api(`/users/${userId}/block`, { method: 'POST' });
    await refreshDashboard();
    notify('Action completed.');
  } catch (error) {
    notify(`Action failed: ${errorMessage(error)}`, 'error');
  }
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowUp' || event.key.toLowerCase() === 'w') state.keys.up = true;
  if (event.key === 'ArrowDown' || event.key.toLowerCase() === 's') state.keys.down = true;
  sendLive('game:input', state.keys);
});

window.addEventListener('keyup', (event) => {
  if (event.key === 'ArrowUp' || event.key.toLowerCase() === 'w') state.keys.up = false;
  if (event.key === 'ArrowDown' || event.key.toLowerCase() === 's') state.keys.down = false;
  sendLive('game:input', state.keys);
});

for (const [button, key] of [
  [el.upButton, 'up'],
  [el.downButton, 'down']
]) {
  button.addEventListener('pointerdown', () => {
    state.keys[key] = true;
    sendLive('game:input', state.keys);
  });
  button.addEventListener('pointerup', () => {
    state.keys[key] = false;
    sendLive('game:input', state.keys);
  });
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101820);
const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 100);
camera.position.set(0, -8.8, 6.2);
camera.lookAt(0, 0, 0);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
el.gameCanvas.append(renderer.domElement);

const table = new THREE.Mesh(
  new THREE.BoxGeometry(12.5, 7.5, 0.16),
  new THREE.MeshStandardMaterial({ color: 0x22313f, roughness: 0.55 })
);
table.position.z = -0.12;
scene.add(table);

const centerLine = new THREE.Mesh(
  new THREE.BoxGeometry(0.08, 7.1, 0.04),
  new THREE.MeshBasicMaterial({ color: 0xd7f9f1 })
);
centerLine.position.z = 0.02;
scene.add(centerLine);

const paddleMaterial = new THREE.MeshStandardMaterial({ color: 0x2dd4bf, roughness: 0.35 });
const opponentMaterial = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.35 });
const ballMaterial = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.18 });
const leftPaddle = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.6, 0.38), paddleMaterial);
const rightPaddle = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.6, 0.38), opponentMaterial);
leftPaddle.position.set(-5.5, 0, 0.25);
rightPaddle.position.set(5.5, 0, 0.25);
scene.add(leftPaddle, rightPaddle);

const ball = new THREE.Mesh(new THREE.SphereGeometry(0.18, 32, 16), ballMaterial);
ball.position.z = 0.28;
scene.add(ball);

const ambient = new THREE.AmbientLight(0xffffff, 0.55);
const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
keyLight.position.set(0, -5, 8);
scene.add(ambient, keyLight);

function resizeRenderer() {
  const rect = el.gameCanvas.getBoundingClientRect();
  renderer.setSize(rect.width, rect.height, false);
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
}

function syncScene(room) {
  if (!room) return;
  const [left, right] = room.players;
  leftPaddle.position.y = room.paddleY[left] ?? 0;
  rightPaddle.position.y = room.paddleY[right] ?? 0;
  ball.position.x = room.ball.x;
  ball.position.y = room.ball.y;
}

function animate() {
  resizeRenderer();
  ball.rotation.x += 0.05;
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

try {
  const data = await api('/me');
  showApp(data.user);
} catch {
  showAuth();
}
