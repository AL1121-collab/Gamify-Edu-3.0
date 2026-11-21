// ============================================
// student.js — v8 (Sala Ativa)
// ============================================
let currentUser = null;
let currentProfile = null;
let chatChannel = null;
let chatRoomId = null;
let chatMessagesCache = [];
let activeRoomId = localStorage.getItem('gamify-active-room'); // Memória da sala

(async function init() {
  const auth = await requireAuth('student');
  if (!auth) return;
  currentUser = auth.session.user;
  currentProfile = auth.profile;
  renderUserHeader();
  setupNavigation();
  window.onViewChange = (view) => {
    if (view === 'rooms') loadRooms();
    if (view === 'activities') loadActivities();
    if (view === 'chat') loadChatRoomSelector();
    if (view === 'ranking') loadRanking();
    if (view === 'badges') loadBadges();
    if (view === 'profile') loadProfileView();
  };
  await loadDashboard();
})();

function renderUserHeader() {
  const el = document.getElementById('user-avatar');
  if (el) el.innerHTML = renderAvatar(currentProfile, 40);

  // Mostra o nome da sala ativa no topo
  const roomTitle = document.getElementById('active-room-title');
  if (roomTitle) {
    if (activeRoomId) {
      supabaseClient.from('rooms').select('name').eq('id', activeRoomId).single().then(({ data }) => {
        if (data) roomTitle.textContent = `Sala: ${data.name}`;
      });
    } else {
      roomTitle.textContent = 'Selecione uma sala';
    }
  }
}

// ===== DASHBOARD =====
async function loadDashboard() {
  const { data: profile } = await supabaseClient
    .from('profiles').select('points, avatar_url').eq('id', currentUser.id).single();
  const points = profile?.points || 0;
  document.getElementById('user-points').textContent = points;
  document.getElementById('stat-points').textContent = points;
  if (profile?.avatar_url) currentProfile.avatar_url = profile.avatar_url;
  renderUserHeader();

  const { data: subs } = await supabaseClient
    .from('submissions').select('correct_answers, total_questions, quiz_id').eq('student_id', currentUser.id);

  // Conta apenas as submissões da sala ativa
  const activeQuizIds = [];
  if (activeRoomId) {
    const { data: activeQuizzes } = await supabaseClient.from('quizzes').select('id').eq('room_id', activeRoomId);
    activeQuizzes?.forEach(q => activeQuizIds.push(q.id));
  }

  const filteredSubs = (subs || []).filter(s => activeQuizIds.includes(s.quiz_id));

  document.getElementById('stat-activities').textContent = new Set(filteredSubs.map(s => s.quiz_id)).size;

  const totalCorrect = filteredSubs.reduce((s, x) => s + (x.correct_answers || 0), 0);
  const totalQ = filteredSubs.reduce((s, x) => s + (x.total_questions || 0), 0);
  document.getElementById('stat-accuracy').textContent = (totalQ ? Math.round((totalCorrect / totalQ) * 100) : 0) + '%';

  const container = document.getElementById('next-activities');
  container.innerHTML = '';

  if (activeRoomId) {
    const { data: quizzes } = await supabaseClient
      .from('quizzes').select('*, rooms!inner(name)')
      .eq('room_id', activeRoomId).order('created_at', { ascending: false }).limit(10);
    const submittedIds = new Set((subs || []).map(s => s.quiz_id));

    (quizzes || []).filter(q => {
      if (submittedIds.has(q.id)) return false;
      if (q.due_date && new Date(q.due_date) < new Date()) return false;
      return true;
    }).slice(0, 4).forEach(q => {
      const timeLabel = q.time_limit_minutes ? ` · ${q.time_limit_minutes} min` : '';
      const div = document.createElement('div');
      div.className = 'activity-item';
      div.innerHTML = `
        <div class="activity-info">
          <h4>${escapeHtml(q.title)}</h4>
          <p>${escapeHtml(q.rooms?.name)} · ${q.points_per_correct} pts/acerto${timeLabel}</p>
        </div>
        <div class="activity-actions">
          <button class="btn btn-primary btn-sm" onclick="startQuiz('${q.id}')">Começar</button>
        </div>`;
      container.appendChild(div);
    });
  }
  if (!container.children.length) container.innerHTML = '<p class="empty-text">Nenhuma atividade pendente.</p>';
}

// ===== SALAS =====
async function loadRooms() {
  const { data: memberships } = await supabaseClient
    .from('room_members').select('room_id, rooms(*)').eq('student_id', currentUser.id);
  const container = document.getElementById('rooms-list');
  container.innerHTML = '';

  if (!memberships?.length) {
    container.innerHTML = '<p class="empty-text">Você ainda não está em nenhuma sala.</p>';
    return;
  }

  memberships.forEach(m => {
    const r = m.rooms; if (!r) return;
    const isActive = activeRoomId === r.id;
    const div = document.createElement('div');
    div.className = 'room-card';
    if (isActive) div.style.border = '2px solid var(--primary)';

    div.innerHTML = `
      <h4>${escapeHtml(r.name)} ${isActive ? '<span class="badge badge-success">Ativa</span>' : ''}</h4>
      <p>${escapeHtml(r.description || 'Sem descrição')}</p>
      <div class="room-code">${r.code}</div>
      <div class="row-actions" style="margin-top:12px;">
        ${!isActive ? `<button class="btn btn-primary btn-sm" onclick="selectRoom('${r.id}')">Acessar</button>` : ''}
        <button class="btn btn-outline btn-sm" onclick="openChat('${r.id}', '${escapeHtml(r.name).replace(/'/g, "\\'")}')">Chat</button>
      </div>`;
    container.appendChild(div);
  });
}

async function selectRoom(roomId) {
  activeRoomId = roomId;
  localStorage.setItem('gamify-active-room', roomId);
  showToast('Sala alterada');
  loadRooms();
  loadDashboard();
  if (document.getElementById('view-activities').classList.contains('active')) loadActivities();
  if (document.getElementById('view-ranking').classList.contains('active')) loadRanking();
}

// ===== ATIVIDADES =====
async function loadActivities() {
  const container = document.getElementById('activities-list');
  container.innerHTML = '';

  if (!activeRoomId) {
    container.innerHTML = '<p class="empty-text">Selecione uma sala ativa em "Minhas Salas".</p>';
    return;
  }

  const { data: quizzes } = await supabaseClient
    .from('quizzes').select('*, rooms(name)')
    .eq('room_id', activeRoomId).order('created_at', { ascending: false });
  const { data: subs } = await supabaseClient
    .from('submissions').select('quiz_id, correct_answers, total_questions, reviewed')
    .eq('student_id', currentUser.id);

  const subMap = new Map();
  (subs || []).forEach(s => {
    if (!subMap.has(s.quiz_id)) subMap.set(s.quiz_id, []);
    subMap.get(s.quiz_id).push(s);
  });

  if (!quizzes?.length) {
    container.innerHTML = '<p class="empty-text">Nenhuma atividade disponível nesta sala.</p>';
    return;
  }

  quizzes.forEach(q => {
    const subsForQuiz = subMap.get(q.id) || [];
    const done = subsForQuiz.length > 0;
    const isExpired = q.due_date && new Date(q.due_date) < new Date();

    let badge = '';
    if (done) badge = '<span class="badge badge-success">Concluída</span>';
    else if (isExpired) badge = '<span class="badge badge-danger">Expirada</span>';

    const timeLabel = q.time_limit_minutes ? ` · ${q.time_limit_minutes} min` : '';
    let actionBtn = '';
    if (!done && !isExpired) actionBtn = `<button class="btn btn-primary btn-sm" onclick="startQuiz('${q.id}')">Começar</button>`;
    else if (isExpired && !done) actionBtn = `<span style="font-size:12px;color:var(--gray);">Prazo encerrado</span>`;

    const div = document.createElement('div');
    div.className = 'activity-item';
    div.innerHTML = `
      <div class="activity-info">
        <h4>${escapeHtml(q.title)} ${badge}</h4>
        <p>${escapeHtml(q.rooms?.name)} · ${q.points_per_correct} pts/acerto${timeLabel}</p>
      </div>
      <div class="activity-actions">${actionBtn}</div>`;
    container.appendChild(div);
  });
}

function startQuiz(id) { window.location.href = `quiz.html?id=${id}`; }

// ===== RANKING =====
async function loadRanking() {
  const container = document.getElementById('ranking-chart');
  const correctContainer = document.getElementById('ranking-correct');

  if (!activeRoomId) {
    container.innerHTML = '<p class="empty-text">Selecione uma sala ativa.</p>';
    correctContainer.innerHTML = '';
    return;
  }

  container.innerHTML = '<p class="empty-text">Carregando...</p>';
  const { data: rows } = await supabaseClient.rpc('get_room_ranking_points', { p_room_id: activeRoomId });
  const list = (rows || []).map(r => ({
    label: r.student_name,
    value: r.points || 0,
    profile: { name: r.student_name, avatar_url: r.avatar_url }
  }));
  container.innerHTML = renderBarChart(list, { suffix: ' pts' });

  const { data: rowsCorrect } = await supabaseClient.rpc('get_room_ranking_correct', { p_room_id: activeRoomId });
  const listCorrect = (rowsCorrect || []).map(r => ({
    label: r.student_name,
    value: Number(r.total_correct) || 0,
    profile: { name: r.student_name, avatar_url: r.avatar_url }
  }));
  correctContainer.innerHTML = renderBarChart(listCorrect, { suffix: ' acertos' });
}

// ===== BADGES =====
async function loadBadges() {
  const { data: profile } = await supabaseClient.from('profiles').select('points').eq('id', currentUser.id).single();
  const { data: subs } = await supabaseClient.from('submissions').select('*').eq('student_id', currentUser.id);
  const points = profile?.points || 0;
  const totalActivities = new Set((subs || []).map(s => s.quiz_id)).size;
  const totalCorrect = (subs || []).reduce((s, x) => s + x.correct_answers, 0);
  const badges = [
    { name: 'Primeiro passo', desc: '1 atividade', unlocked: totalActivities >= 1 },
    { name: 'Em ritmo', desc: '5 atividades', unlocked: totalActivities >= 5 },
    { name: 'Centurião', desc: '100 pontos', unlocked: points >= 100 },
    { name: 'Meio milhar', desc: '500 pontos', unlocked: points >= 500 },
    { name: 'Rei do ranking', desc: '1000 pontos', unlocked: points >= 1000 },
    { name: 'Precisão', desc: '50 acertos', unlocked: totalCorrect >= 50 },
    { name: 'Estudioso', desc: '10 atividades', unlocked: totalActivities >= 10 },
    { name: 'Foguete', desc: '20 atividades', unlocked: totalActivities >= 20 },
  ];
  const container = document.getElementById('badges-list');
  container.innerHTML = '';
  badges.forEach(b => {
    const div = document.createElement('div');
    div.className = `badge-card ${b.unlocked ? '' : 'locked'}`;
    div.innerHTML = `<h4>${b.name}</h4><p>${b.desc}</p>`;
    container.appendChild(div);
  });
}

// ===== PERFIL =====
async function loadProfileView() {
  const { data: profile } = await supabaseClient.from('profiles').select('*').eq('id', currentUser.id).single();
  if (profile) currentProfile = profile;
  const avatarBox = document.getElementById('profile-avatar');
  if (avatarBox) avatarBox.innerHTML = renderAvatar(currentProfile, 96);
  const nameBox = document.getElementById('profile-name');
  if (nameBox) nameBox.textContent = currentProfile.name;
  const pointsBox = document.getElementById('profile-points');
  if (pointsBox) pointsBox.textContent = currentProfile.points || 0;

  const fbContainer = document.getElementById('profile-feedback');
  if (fbContainer) {
    const { data: subs } = await supabaseClient
      .from('submissions').select('*, quizzes(title)')
      .eq('student_id', currentUser.id).eq('reviewed', true)
      .not('teacher_feedback', 'is', null)
      .order('created_at', { ascending: false }).limit(10);
    fbContainer.innerHTML = '';
    if (!subs?.length) fbContainer.innerHTML = '<p class="empty-text">Nenhum feedback ainda.</p>';
    else subs.forEach(s => {
      const div = document.createElement('div');
      div.className = 'feedback-card';
      div.innerHTML = `<div class="feedback-head"><strong>${escapeHtml(s.quizzes?.title || 'Atividade')}</strong><span class="badge badge-success">+${s.points_earned} pts</span></div><p>${escapeHtml(s.teacher_feedback)}</p>`;
      fbContainer.appendChild(div);
    });
  }
}

async function handleAvatarUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { showToast('Imagem muito grande (máx. 2MB)', 'error'); return; }
  try {
    const url = await uploadAvatar(file, currentUser.id);
    currentProfile.avatar_url = url;
    renderUserHeader();
    const avatarBox = document.getElementById('profile-avatar');
    if (avatarBox) avatarBox.innerHTML = renderAvatar(currentProfile, 96);
    showToast('Foto atualizada');
  } catch (err) {
    showToast('Erro ao enviar foto', 'error');
  }
}

// ===== CHAT =====
async function getMemberships() {
  const { data } = await supabaseClient
    .from('room_members').select('room_id, rooms(id, name)').eq('student_id', currentUser.id);
  return (data || []).filter(m => m.rooms);
}

// Preenche o seletor de salas (sem abrir nenhuma sala)
async function populateChatSelector() {
  const memberships = await getMemberships();
  const select = document.getElementById('chat-room-select');
  if (!select) return memberships;

  select.innerHTML = '<option value="">Selecione uma sala</option>' +
    memberships.map(m => `<option value="${m.rooms.id}">${escapeHtml(m.rooms.name)}</option>`).join('');
  select.value = chatRoomId || '';

  select.onchange = () => {
    const roomId = select.value;
    if (!roomId) { closeChat(); return; }
    openChat(roomId, select.options[select.selectedIndex].text);
  };
  return memberships;
}

// Chamado quando a aba Chat é aberta pela navegação
async function loadChatRoomSelector() {
  const memberships = await populateChatSelector();
  // Se nenhuma sala está aberta, abre a sala ativa
  if (!chatRoomId && activeRoomId) {
    const room = memberships.find(m => m.rooms.id === activeRoomId);
    if (room) openChat(activeRoomId, room.rooms.name);
  }
}

async function openChat(roomId, roomName) {
  if (chatChannel) {
    await supabaseClient.removeChannel(chatChannel);
    chatChannel = null;
  }
  chatRoomId = roomId;

  // Troca para a aba de chat, se ainda não estiver nela
  const chatView = document.getElementById('view-chat');
  if (chatView && !chatView.classList.contains('active')) {
    document.querySelectorAll('.side-link').forEach(l => l.classList.toggle('active', l.dataset.view === 'chat'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    chatView.classList.add('active');
    document.getElementById('view-title').textContent = 'Chat';
  }

  await populateChatSelector();

  const nameEl = document.getElementById('chat-room-name');
  if (nameEl) {
    nameEl.textContent = roomName;
    nameEl.style.display = 'block';
  }

  await loadChatHistory(roomId);

  chatChannel = supabaseClient
    .channel(`chat:${roomId}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${roomId}` },
      async (payload) => {
        if (payload.new.room_id !== chatRoomId) return;
        chatMessagesCache.push(payload.new);
        if (chatMessagesCache.length > 30) chatMessagesCache.shift();
        renderChatMessages();
        supabaseClient.rpc('trim_chat_messages', { p_room_id: roomId }).catch(() => {});
      })
    .subscribe();
}

function closeChat() {
  if (chatChannel) {
    supabaseClient.removeChannel(chatChannel);
    chatChannel = null;
  }
  chatRoomId = null;
  chatMessagesCache = [];
  const box = document.getElementById('chat-messages');
  if (box) box.innerHTML = '';
  const name = document.getElementById('chat-room-name');
  if (name) name.style.display = 'none';
}

async function loadChatHistory(roomId) {
  const box = document.getElementById('chat-messages');
  box.innerHTML = '<p class="empty-text">Carregando...</p>';
  const { data: msgs, error } = await supabaseClient
    .from('chat_messages').select('*, profiles:sender_id(name, avatar_url)')
    .eq('room_id', roomId).order('created_at', { ascending: false }).limit(30);
  if (error) {
    box.innerHTML = `<p class="empty-text">Erro: ${error.message}</p>`;
    return;
  }
  chatMessagesCache = (msgs || []).reverse();
  renderChatMessages();
}

async function renderChatMessages() {
  const box = document.getElementById('chat-messages');
  if (!box) return;
  if (!chatMessagesCache.length) {
    box.innerHTML = '<p class="empty-text">Nenhuma mensagem ainda. Comece a conversa.</p>';
    return;
  }
  const { data: room } = await supabaseClient.from('rooms').select('teacher_id').eq('id', chatRoomId).single();
  const teacherId = room?.teacher_id;

  box.innerHTML = chatMessagesCache.map(m => {
    const isMine = m.sender_id === currentUser.id;
    const isTeacher = m.sender_id === teacherId;
    const avatar = renderAvatar(m.profiles || { name: m.sender_name }, 32, isTeacher);
    const side = isMine ? 'mine' : 'theirs';
    return `
      <div class="chat-msg ${side}">
        <div class="chat-avatar">${avatar}</div>
        <div class="chat-body">
          <div class="chat-meta">
            <span class="chat-name">${escapeHtml(isMine ? 'Você' : (m.profiles?.name || m.sender_name))}</span>
            <span class="chat-time">${formatTime(m.created_at)}</span>
          </div>
          <div class="chat-bubble">${escapeHtml(m.message)}</div>
        </div>
      </div>`;
  }).join('');
  box.scrollTop = box.scrollHeight;
}

async function sendChatMessage(event) {
  if (event) event.preventDefault();
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text || !chatRoomId) return;
  input.value = '';
  const { error } = await supabaseClient.from('chat_messages').insert({
    room_id: chatRoomId,
    sender_id: currentUser.id,
    sender_name: currentProfile.name,
    message: text
  });
  if (error) {
    showToast('Erro ao enviar', 'error');
    input.value = text;
  }
}