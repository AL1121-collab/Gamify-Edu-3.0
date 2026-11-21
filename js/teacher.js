// ============================================
// teacher.js — v8 (Com gabarito e imagens)
// ============================================
let currentUser = null;
let currentProfile = null;
let questionCount = 0;
let chatChannel = null;
let chatRoomId = null;
let chatMessagesCache = [];

(async function init() {
  const auth = await requireAuth('teacher');
  if (!auth) return;
  currentUser = auth.session.user;
  currentProfile = auth.profile;
  renderTeacherHeader();
  setupNavigation();
  window.onViewChange = (view) => {
    if (view === 'rooms') loadRooms();
    if (view === 'quizzes') loadQuizzes();
    if (view === 'students') loadStudents();
    if (view === 'chat') loadChatRoomSelector();
    if (view === 'reports') { loadReports(); loadPendingReviews(); loadPieChart(); }
    if (view === 'ranking') loadTeacherRankingCharts();
    if (view === 'profile') loadTeacherProfile();
  };
  await loadDashboard();
})();

function renderTeacherHeader() { 
  const el = document.getElementById('user-avatar'); 
  if (el) el.innerHTML = renderAvatar(currentProfile, 40); 
}

async function loadDashboard() {
  const { data: rooms } = await supabaseClient.from('rooms').select('id').eq('teacher_id', currentUser.id);
  document.getElementById('stat-rooms').textContent = rooms?.length || 0;
  const roomIds = (rooms || []).map(r => r.id);
  
  if (roomIds.length) {
    const { data: members } = await supabaseClient.from('room_members').select('*').in('room_id', roomIds);
    document.getElementById('stat-students').textContent = members?.length || 0;
    const { data: quizzes } = await supabaseClient.from('quizzes').select('id').in('room_id', roomIds);
    document.getElementById('stat-quizzes').textContent = quizzes?.length || 0;
    
    const quizIds = (quizzes || []).map(q => q.id);
    if (quizIds.length) {
      const { data: subs } = await supabaseClient.from('submissions').select('*, profiles(name), quizzes(title)').in('quiz_id', quizIds).order('created_at', { ascending: false }).limit(10);
      document.getElementById('stat-submissions').textContent = subs?.length || 0;
      const container = document.getElementById('recent-submissions');
      container.innerHTML = '';
      (subs || []).forEach(s => {
        const div = document.createElement('div');
        div.className = 'submission-item';
        div.innerHTML = `<div><strong>${escapeHtml(s.profiles?.name || 'Aluno')}</strong> respondeu <strong>${escapeHtml(s.quizzes?.title || 'Quiz')}</strong></div><span class="badge badge-info">${s.correct_answers}/${s.total_questions} · ${formatDate(s.created_at)}</span>`;
        container.appendChild(div);
      });
      if (!container.children.length) container.innerHTML = '<p class="empty-text">Nenhuma resposta ainda.</p>';
    }
  }
}

// ===== SALAS =====
async function loadRooms() {
  const { data: rooms, error } = await supabaseClient.from('rooms').select('*').eq('teacher_id', currentUser.id).order('created_at', { ascending: false });
  const container = document.getElementById('teacher-rooms-list');
  container.innerHTML = '';
  
  if (error) { container.innerHTML = `<p class="empty-text">Erro: ${error.message}</p>`; return; }

  (rooms || []).forEach(r => {
    const div = document.createElement('div');
    div.className = 'room-card';
    div.innerHTML = `
      <h4>${escapeHtml(r.name)}</h4>
      <p>${escapeHtml(r.description || 'Sem descrição')}</p>
      <div class="room-code-row">
        <div class="room-code">${r.code}</div>
        <button class="btn btn-outline btn-sm" onclick="copyCode('${r.code}')">Copiar</button>
      </div>
      <div class="row-actions">
        <button class="btn btn-outline btn-sm" onclick="openChat('${r.id}', '${escapeHtml(r.name).replace(/'/g, "\\'")}')">Abrir chat</button>
        <button class="btn btn-outline btn-sm btn-danger" onclick="confirmDeleteRoom('${r.id}', '${escapeHtml(r.name).replace(/'/g, "\\'")}')">Excluir</button>
      </div>`;
    container.appendChild(div);
  });
  if (!container.children.length) container.innerHTML = '<p class="empty-text">Crie sua primeira sala.</p>';
}

function copyCode(code) { navigator.clipboard.writeText(code); showToast('Código copiado'); }
function openRoomModal() { document.getElementById('room-modal').classList.add('active'); }

async function createRoom() {
  const name = document.getElementById('room-name').value.trim();
  const desc = document.getElementById('room-desc').value.trim();
  if (!name) { showToast('Digite um nome', 'error'); return; }
  if (!currentUser?.id) { showToast('Sessão expirou', 'error'); return; }

  const code = generateRoomCode();
  const { error } = await supabaseClient.from('rooms').insert({ name, description: desc, code, teacher_id: currentUser.id });
  if (error) { showToast('Erro: ' + error.message, 'error'); return; }

  closeModal('room-modal');
  document.getElementById('room-name').value = '';
  document.getElementById('room-desc').value = '';
  showToast('Sala criada · Código: ' + code);
  loadRooms();
}

async function confirmDeleteRoom(roomId, name) {
  if (!confirm(`Excluir a sala "${name}"? Todas as atividades, respostas e mensagens serão apagadas.`)) return;
  const { error } = await supabaseClient.rpc('delete_room', { p_room_id: roomId });
  if (error) { showToast('Erro: ' + error.message, 'error'); return; }
  showToast('Sala excluída');
  loadRooms();
  loadDashboard();
}

// ===== QUIZZES =====
async function openQuizModal() {
  const { data: rooms } = await supabaseClient.from('rooms').select('*').eq('teacher_id', currentUser.id);
  if (!rooms?.length) { showToast('Crie uma sala antes', 'error'); return; }

  const select = document.getElementById('quiz-room');
  select.innerHTML = rooms.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
  document.getElementById('questions-container').innerHTML = '';
  document.getElementById('quiz-time').value = '';
  document.getElementById('quiz-due-date').value = '';
  // Reseta o checkbox de gabarito para marcado por padrão
  const showResCheck = document.getElementById('quiz-show-results');
  if (showResCheck) showResCheck.checked = true;
  
  questionCount = 0;
  addQuestion();
  document.getElementById('quiz-modal').classList.add('active');
}

function addQuestion() {
  questionCount++;
  const n = questionCount;
  const container = document.getElementById('questions-container');
  const block = document.createElement('div');
  block.className = 'question-block';
  block.dataset.qid = n;
  block.innerHTML = `
    <div class="q-header">
      <span>Pergunta ${n}</span>
      <button class="remove-q" onclick="this.closest('.question-block').remove()">×</button>
    </div>
    <input type="text" class="q-text input-full" placeholder="Escreva a pergunta">
    
    <!-- CAMPO DE IMAGEM -->
    <div class="form-group" style="margin-bottom: 12px;">
      <label style="font-size:12px; color:var(--gray);">Imagem da Pergunta (opcional)</label>
      <input type="file" class="q-image" accept="image/*" style="font-size:12px; background:var(--bg); padding:8px; border-radius:6px;">
    </div>

    <div class="q-type-selector">
      <label class="q-type-option">
        <input type="radio" name="qtype-${n}" value="multiple_choice" checked onchange="toggleQuestionType(${n})">
        <span>Múltipla escolha</span>
      </label>
      <label class="q-type-option">
        <input type="radio" name="qtype-${n}" value="text" onchange="toggleQuestionType(${n})">
        <span>Resposta escrita</span>
      </label>
    </div>
    <div class="options" id="options-${n}">
      ${[0,1,2,3].map(i => `
        <div class="option-row">
          <input type="radio" name="correct-${n}" value="${i}" ${i===0?'checked':''}>
          <input type="text" class="opt-text" placeholder="Opção ${i+1}">
        </div>`).join('')}
    </div>
    <div class="text-answer-info" id="text-info-${n}" style="display:none;">
      <div class="info-box">O aluno vai digitar a resposta. Você corrige depois em Relatórios.</div>
    </div>`;
  container.appendChild(block);
}

function toggleQuestionType(n) {
  const type = document.querySelector(`input[name="qtype-${n}"]:checked`).value;
  document.getElementById(`options-${n}`).style.display = type === 'text' ? 'none' : 'block';
  document.getElementById(`text-info-${n}`).style.display = type === 'text' ? 'block' : 'none';
}

async function createQuiz() {
  const title = document.getElementById('quiz-title').value.trim();
  const roomId = document.getElementById('quiz-room').value;
  const pointsPerCorrect = parseInt(document.getElementById('quiz-points').value) || 10;
  const timeInput = document.getElementById('quiz-time').value.trim();
  const timeLimit = timeInput ? parseInt(timeInput) : null;
  const dueDateInput = document.getElementById('quiz-due-date').value;
  const dueDate = dueDateInput ? new Date(dueDateInput).toISOString() : null;
  
  // NOVO: Lê a opção do gabarito
  const showResultsInput = document.getElementById('quiz-show-results');
  const showResults = showResultsInput ? showResultsInput.checked : true;

  if (!title || !roomId) { showToast('Preencha título e sala', 'error'); return; }

  const btn = document.querySelector('#quiz-modal button.btn-primary');
  const originalText = btn.textContent;
  btn.disabled = true; btn.textContent = 'Publicando...';

  const blocks = document.querySelectorAll('#questions-container .question-block');
  const questions = [];
  
  // 1. Processar perguntas e fazer upload das imagens
  for (const block of blocks) {
    const n = block.dataset.qid;
    const text = block.querySelector('.q-text').value.trim();
    if (!text) continue;
    
    const type = block.querySelector(`input[name="qtype-${n}"]:checked`)?.value || 'multiple_choice';
    const fileInput = block.querySelector('.q-image');
    let imageUrl = null;

    if (fileInput && fileInput.files.length > 0) {
      const file = fileInput.files[0];
      const filePath = `q_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '')}`;
      
      const { error: uploadError } = await supabaseClient.storage
        .from('question-images')
        .upload(filePath, file);

      if (uploadError) {
        showToast('Erro no upload da imagem: ' + uploadError.message, 'error');
        btn.disabled = false; btn.textContent = originalText;
        return;
      }
      
      const { data: urlData } = supabaseClient.storage
        .from('question-images')
        .getPublicUrl(filePath);
      imageUrl = urlData.publicUrl;
    }

    if (type === 'text') {
      questions.push({ text, options: [], correct: 0, type: 'text', image_url: imageUrl });
    } else {
      const opts = [...block.querySelectorAll('.opt-text')].map(o => o.value.trim());
      const correctIdx = parseInt(block.querySelector(`input[name="correct-${n}"]:checked`)?.value || 0);
      const filtered = opts.filter(o => o);
      if (filtered.length >= 2) {
        questions.push({ text, options: filtered, correct: correctIdx, type: 'multiple_choice', image_url: imageUrl });
      }
    }
  }

  if (questions.length === 0) { 
    showToast('Adicione pelo menos 1 pergunta válida', 'error'); 
    btn.disabled = false; btn.textContent = originalText;
    return; 
  }

  // 2. Cria o Quiz (com a flag show_results)
  const { data: quiz, error } = await supabaseClient.from('quizzes').insert({
    title, room_id: roomId, points_per_correct: pointsPerCorrect,
    created_by: currentUser.id, time_limit_minutes: timeLimit, due_date: dueDate,
    show_results: showResults
  }).select().single();

  if (error) { 
    showToast('Erro: ' + error.message, 'error'); 
    btn.disabled = false; btn.textContent = originalText;
    return; 
  }

  // 3. Insere as perguntas
  const rows = questions.map((q, i) => ({
    quiz_id: quiz.id, question_text: q.text, options: q.options,
    correct_index: q.correct, position: i, question_type: q.type,
    image_url: q.image_url
  }));
  
  const { error: qErr } = await supabaseClient.from('questions').insert(rows);
  if (qErr) { showToast('Erro: ' + qErr.message, 'error'); return; }

  closeModal('quiz-modal');
  document.getElementById('quiz-title').value = '';
  document.getElementById('quiz-time').value = '';
  document.getElementById('quiz-due-date').value = '';
  showToast('Atividade publicada');
  loadQuizzes();
  
  btn.disabled = false; btn.textContent = originalText;
}

async function loadQuizzes() {
  const { data: rooms } = await supabaseClient.from('rooms').select('id').eq('teacher_id', currentUser.id);
  const roomIds = (rooms || []).map(r => r.id);
  const container = document.getElementById('teacher-quizzes-list');
  container.innerHTML = '';
  
  if (!roomIds.length) { container.innerHTML = '<p class="empty-text">Crie uma sala primeiro.</p>'; return; }

  const { data: quizzes } = await supabaseClient.from('quizzes').select('*, rooms(name), questions(id)').in('room_id', roomIds).order('created_at', { ascending: false });

  (quizzes || []).forEach(q => {
    const timeLabel = q.time_limit_minutes ? `${q.time_limit_minutes} min` : 'Sem limite';
    const dueLabel = q.due_date ? ` · Entrega: ${new Date(q.due_date).toLocaleString('pt-BR')}` : '';
    const div = document.createElement('div');
    div.className = 'activity-item';
    div.innerHTML = `
      <div class="activity-info">
        <h4>${escapeHtml(q.title)}</h4>
        <p>${escapeHtml(q.rooms?.name || '')} · ${q.questions?.length || 0} perguntas · ${q.points_per_correct} pts/acerto · ${timeLabel}${dueLabel}</p>
      </div>
      <div class="activity-actions">
        <span class="badge badge-info">${formatDate(q.created_at)}</span>
        <button class="btn btn-outline btn-sm btn-danger" onclick="confirmDeleteQuiz('${q.id}', '${escapeHtml(q.title).replace(/'/g, "\\'")}')">Excluir</button>
      </div>`;
    container.appendChild(div);
  });
  if (!container.children.length) container.innerHTML = '<p class="empty-text">Nenhuma atividade criada.</p>';
}

async function confirmDeleteQuiz(quizId, title) {
  if (!confirm(`Excluir a atividade "${title}"? Todas as respostas serão apagadas.`)) return;
  const { error } = await supabaseClient.rpc('delete_quiz', { p_quiz_id: quizId });
  if (error) { showToast('Erro: ' + error.message, 'error'); return; }
  showToast('Atividade excluída');
  loadQuizzes();
  loadDashboard();
}

// ===== ALUNOS =====
async function loadStudents() {
  const { data: rooms } = await supabaseClient.from('rooms').select('id, name').eq('teacher_id', currentUser.id);
  const roomIds = (rooms || []).map(r => r.id);
  const container = document.getElementById('teacher-students-list');

  if (!roomIds.length) { container.innerHTML = '<p class="empty-text">Crie salas e adicione alunos.</p>'; return; }

  const { data: members } = await supabaseClient.from('room_members').select('*, profiles(name, points, avatar_url)').in('room_id', roomIds);

  if (!members?.length) { container.innerHTML = '<p class="empty-text">Nenhum aluno nas salas ainda.</p>'; return; }

  container.innerHTML = `<table class="data-table">
    <thead><tr><th>Aluno</th><th>Pontos</th><th>Sala</th><th></th></tr></thead>
    <tbody>
      ${members.map(m => {
        const r = rooms.find(x => x.id === m.room_id);
        return `<tr>
          <td><div class="table-user">${renderAvatar(m.profiles, 32)}<span>${escapeHtml(m.profiles?.name || 'Aluno')}</span></div></td>
          <td>${m.profiles?.points || 0}</td>
          <td>${escapeHtml(r?.name || '-')}</td>
          <td><button class="btn btn-outline btn-sm btn-danger" onclick="confirmRemoveStudent('${m.room_id}', '${m.student_id}', '${escapeHtml(m.profiles?.name || 'Aluno').replace(/'/g, "\\'")}')">Remover</button></td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}

async function confirmRemoveStudent(roomId, studentId, name) {
  if (!confirm(`Remover ${name} desta sala?`)) return;
  const { error } = await supabaseClient.rpc('remove_student_from_room', { p_room_id: roomId, p_student_id: studentId });
  if (error) { showToast('Erro: ' + error.message, 'error'); return; }
  showToast('Aluno removido');
  loadStudents();
}

// ===== RELATÓRIOS =====
async function loadReports() {
  const { data: rooms } = await supabaseClient.from('rooms').select('id').eq('teacher_id', currentUser.id);
  const roomIds = (rooms || []).map(r => r.id);
  const container = document.getElementById('reports-content');

  if (!roomIds.length) { container.innerHTML = '<p class="empty-text">Sem dados ainda.</p>'; return; }

  const { data: quizzes } = await supabaseClient.from('quizzes').select('id, title').in('room_id', roomIds);
  const quizIds = (quizzes || []).map(q => q.id);
  if (!quizIds.length) { container.innerHTML = '<p class="empty-text">Crie atividades para ver relatórios.</p>'; return; }

  const { data: subs } = await supabaseClient.from('submissions').select('quiz_id, student_id, correct_answers, total_questions').in('quiz_id', quizIds);

  container.innerHTML = '';
  (quizzes || []).forEach(q => {
    const qSubs = (subs || []).filter(s => s.quiz_id === q.id);
    const students = new Set(qSubs.map(s => s.student_id)).size;
    const totalCorrect = qSubs.reduce((s, x) => s + x.correct_answers, 0);
    const totalQ = qSubs.reduce((s, x) => s + x.total_questions, 0);
    const avg = totalQ ? Math.round((totalCorrect / totalQ) * 100) : 0;

    const div = document.createElement('div');
    div.className = 'report-block';
    div.innerHTML = `
      <div class="report-head"><h4>${escapeHtml(q.title)}</h4><span class="badge badge-info">${students} aluno(s)</span></div>
      <p class="report-line">${qSubs.length} respostas · ${totalCorrect}/${totalQ} acertos · Média <strong>${avg}%</strong></p>
      <div class="progress-track"><div class="progress-fill" style="width:${avg}%"></div></div>`;
    container.appendChild(div);
  });
}

async function loadPendingReviews() {
  const { data: quizzes } = await supabaseClient.from('quizzes').select('id').eq('created_by', currentUser.id);
  const quizIds = (quizzes || []).map(q => q.id);
  const container = document.getElementById('pending-reviews');
  if (!container) return;
  
  if (!quizIds.length) { container.innerHTML = '<p class="empty-text">Nenhuma resposta pendente.</p>'; return; }

  const { data: subs } = await supabaseClient.from('submissions').select('*, profiles(name), quizzes(title)').in('quiz_id', quizIds).eq('reviewed', false).order('created_at', { ascending: false });

  container.innerHTML = '';
  if (!subs?.length) { container.innerHTML = '<p class="empty-text">Nenhuma resposta pendente.</p>'; return; }

  subs.forEach(s => {
    const div = document.createElement('div');
    div.className = 'review-card';
    div.innerHTML = `
      <div class="review-head"><div><strong>${escapeHtml(s.profiles?.name || 'Aluno')}</strong><span class="muted"> · ${escapeHtml(s.quizzes?.title || 'Quiz')}</span></div><span class="badge badge-warning">Pendente</span></div>
      <div class="review-answer"><p class="muted small">Resposta do aluno:</p><div class="answer-box">${escapeHtml(s.text_answer || '(vazio)')}</div></div>
      <div class="review-actions">
        <input type="number" id="pts-${s.id}" placeholder="Pontos" min="0" value="0">
        <input type="text" id="fb-${s.id}" placeholder="Feedback (opcional)">
        <button class="btn btn-primary btn-sm" onclick="submitGrade('${s.id}')">Corrigir</button>
      </div>`;
    container.appendChild(div);
  });
}

async function submitGrade(submissionId) {
  const points = parseInt(document.getElementById(`pts-${submissionId}`).value) || 0;
  const feedback = document.getElementById(`fb-${submissionId}`).value.trim() || null;
  const { error } = await supabaseClient.rpc('mark_submission_reviewed', { p_submission_id: submissionId, p_points: points, p_feedback: feedback });
  if (error) { showToast('Erro: ' + error.message, 'error'); return; }
  showToast('Correção salva');
  loadPendingReviews();
}

// ===== GRÁFICO DE PIZZA =====
async function loadPieChart() {
  const container = document.getElementById('pie-chart-container');
  const roomSelect = document.getElementById('pie-room-select');
  if (!container || !roomSelect) return;

  const { data: rooms } = await supabaseClient.from('rooms').select('id, name').eq('teacher_id', currentUser.id);
  if (!rooms?.length) { roomSelect.innerHTML = ''; container.innerHTML = '<p class="empty-text">Crie uma sala primeiro.</p>'; return; }

  roomSelect.innerHTML = rooms.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');

  const renderFor = async (roomId) => {
    container.innerHTML = '<p class="empty-text">Carregando...</p>';
    const { data, error } = await supabaseClient.rpc('get_student_correct_totals', { p_room_id: roomId });
    if (error) { container.innerHTML = `<p class="empty-text">Erro: ${error.message}</p>`; return; }
    const withData = (data || []).filter(d => Number(d.total_correct) > 0);
    if (!withData.length) { container.innerHTML = '<p class="empty-text">Nenhum acerto registrado nessa sala.</p>'; return; }
    const chartData = withData.slice(0, 10).map(d => ({ label: d.student_name, value: Number(d.total_correct) }));
    container.innerHTML = renderPieChart(chartData, 240);
  };

  roomSelect.onchange = () => renderFor(roomSelect.value);
  await renderFor(rooms[0].id);
}

// ===== RANKING POR SALA (professor) =====
async function loadTeacherRankingCharts() {
  const { data: rooms } = await supabaseClient.from('rooms').select('id, name').eq('teacher_id', currentUser.id);
  const select = document.getElementById('teacher-ranking-room-select');
  
  if (!select) return;
  select.innerHTML = '<option value="">Selecione uma sala</option>' + (rooms || []).map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
  
  select.onchange = () => {
    if (select.value) renderTeacherRoomRanking(select.value);
    else {
      document.getElementById('teacher-ranking-points').innerHTML = '<p class="empty-text">Selecione uma sala.</p>';
      document.getElementById('teacher-ranking-correct').innerHTML = '';
    }
  };
  
  if (rooms?.length) {
    select.value = rooms[0].id;
    renderTeacherRoomRanking(rooms[0].id);
  }
}

async function renderTeacherRoomRanking(roomId) {
  const { data: points } = await supabaseClient.rpc('get_room_ranking_points', { p_room_id: roomId });
  const { data: correct } = await supabaseClient.rpc('get_room_ranking_correct', { p_room_id: roomId });
  
  const pointsList = (points || []).map(r => ({ label: r.student_name, value: r.points || 0, profile: { name: r.student_name, avatar_url: r.avatar_url } }));
  const correctList = (correct || []).map(r => ({ label: r.student_name, value: Number(r.total_correct) || 0, profile: { name: r.student_name, avatar_url: r.avatar_url } }));
  
  document.getElementById('teacher-ranking-points').innerHTML = renderBarChart(pointsList, { suffix: ' pts' });
  document.getElementById('teacher-ranking-correct').innerHTML = renderBarChart(correctList, { suffix: ' acertos' });
}

// ===== PERFIL =====
async function loadTeacherProfile() {
  const { data: profile } = await supabaseClient.from('profiles').select('*').eq('id', currentUser.id).single();
  if (profile) currentProfile = profile;

  const avatarBox = document.getElementById('teacher-profile-avatar');
  if (avatarBox) avatarBox.innerHTML = renderAvatar(currentProfile, 96);
  const nameBox = document.getElementById('teacher-profile-name');
  if (nameBox) nameBox.textContent = currentProfile.name;
  renderTeacherHeader();
}

async function handleTeacherAvatarUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { showToast('Imagem muito grande (máx. 2MB)', 'error'); return; }
  if (!file.type.startsWith('image/')) { showToast('Selecione uma imagem', 'error'); return; }

  try {
    const url = await uploadAvatar(file, currentUser.id);
    currentProfile.avatar_url = url;
    renderTeacherHeader();
    const avatarBox = document.getElementById('teacher-profile-avatar');
    if (avatarBox) avatarBox.innerHTML = renderAvatar(currentProfile, 96);
    showToast('Foto atualizada');
  } catch (err) {
    console.error(err);
    showToast('Erro ao enviar foto', 'error');
  }
}

// ============================================
// CHAT DA TURMA (professor)
// ============================================
async function loadChatRoomSelector() {
  const { data: rooms } = await supabaseClient.from('rooms').select('id, name').eq('teacher_id', currentUser.id);
  const select = document.getElementById('chat-room-select');
  if (!select) return;
  
  select.innerHTML = '<option value="">Selecione uma sala</option>' + (rooms || []).map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');

  select.onchange = () => {
    const roomId = select.value;
    if (!roomId) { closeChat(); return; }
    openChat(roomId, select.options[select.selectedIndex].text);
  };

  if (chatRoomId) select.value = chatRoomId;
}

async function openChat(roomId, roomName) {
  if (chatChannel) { await supabaseClient.removeChannel(chatChannel); chatChannel = null; }
  chatRoomId = roomId;

  const chatView = document.getElementById('view-chat');
  if (chatView && !chatView.classList.contains('active')) {
    document.querySelectorAll('.side-link').forEach(l => { l.classList.toggle('active', l.dataset.view === 'chat'); });
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    chatView.classList.add('active');
    document.getElementById('view-title').textContent = 'Chat';
    await loadChatRoomSelector();
    const s = document.getElementById('chat-room-select');
    if (s) s.value = roomId;
  }

  document.getElementById('chat-room-name').textContent = roomName;
  document.getElementById('chat-room-name').style.display = 'block';

  await loadChatHistory(roomId);

  chatChannel = supabaseClient.channel(`chat:${roomId}`).on('postgres_changes', {
    event: 'INSERT', schema: 'public', table: 'chat_messages',
    filter: `room_id=eq.${roomId}`
  }, async (payload) => {
    chatMessagesCache.push(payload.new);
    if (chatMessagesCache.length > 30) chatMessagesCache.shift();
    renderChatMessages();
    supabaseClient.rpc('trim_chat_messages', { p_room_id: roomId }).catch(() => {});
  }).subscribe();
}

function closeChat() {
  if (chatChannel) { supabaseClient.removeChannel(chatChannel); chatChannel = null; }
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

  const { data: msgs, error } = await supabaseClient.from('chat_messages').select('*, profiles:sender_id(name, avatar_url)').eq('room_id', roomId).order('created_at', { ascending: false }).limit(30);

  if (error) { box.innerHTML = `<p class="empty-text">Erro: ${error.message}</p>`; return; }
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
    return `<div class="chat-msg ${side}">
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
    room_id: chatRoomId, sender_id: currentUser.id,
    sender_name: currentProfile.name, message: text
  });
  if (error) { showToast('Erro ao enviar', 'error'); input.value = text; }
}