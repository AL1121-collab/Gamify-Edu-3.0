// ============================================
// quiz.js — Formato Google Forms com Gabarito
// ============================================
let quiz = null;
let questions = [];
let student = null;
let timerInterval = null;
let timeRemaining = 0;
let studentAnswers = []; // Variável global para guardar as respostas do aluno

(async function init() {
  const auth = await requireAuth('student');
  if (!auth) return;
  student = auth.session.user;

  const params = new URLSearchParams(window.location.search);
  const quizId = params.get('id');
  if (!quizId) { window.location.href = 'student.html'; return; }

  const { data: q } = await supabaseClient
    .from('quizzes').select('*').eq('id', quizId).single();
    
  if (!q) { alert('Atividade não encontrada'); window.location.href = 'student.html'; return; }
  quiz = q;

  // VERIFICAÇÃO DE PRAZO
  if (quiz.due_date && new Date(quiz.due_date) < new Date()) {
    alert('O prazo para esta atividade já encerrou.');
    window.location.href = 'student.html';
    return;
  }

  // VERIFICAÇÃO DE DUPLICIDADE
  const { data: existingSubs } = await supabaseClient
    .from('submissions').select('id').eq('quiz_id', quizId).eq('student_id', student.id).limit(1);
    
  if (existingSubs && existingSubs.length > 0) {
    alert('Você já respondeu esta atividade.');
    window.location.href = 'student.html';
    return;
  }

  const { data: qs } = await supabaseClient
    .from('questions').select('*').eq('quiz_id', quizId).order('position');
  questions = qs || [];
  if (!questions.length) { alert('Sem perguntas'); window.location.href = 'student.html'; return; }

  document.getElementById('quiz-title-display').textContent = quiz.title;

  if (quiz.time_limit_minutes) {
    timeRemaining = quiz.time_limit_minutes * 60;
    startTimer();
  }
  
  renderForm();
})();

function startTimer() {
  const timerEl = document.getElementById('quiz-timer');
  if (timerEl) timerEl.style.display = 'flex';
  updateTimerDisplay();
  timerInterval = setInterval(() => {
    timeRemaining--;
    updateTimerDisplay();
    if (timeRemaining <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      showToast('Tempo esgotado! Enviando respostas...', 'error');
      document.getElementById('quiz-form').requestSubmit();
    }
  }, 1000);
}

function updateTimerDisplay() {
  const timerEl = document.getElementById('quiz-timer');
  if (!timerEl) return;
  const mins = Math.floor(timeRemaining / 60);
  const secs = timeRemaining % 60;
  const display = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  const label = timerEl.querySelector('.timer-value');
  if (label) label.textContent = display;
  
  if (timeRemaining <= 30) { timerEl.style.background = '#FEE2E2'; timerEl.style.color = '#DC2626'; }
  else if (timeRemaining <= 60) { timerEl.style.background = '#FEF3C7'; timerEl.style.color = '#B45309'; }
  else { timerEl.style.background = 'var(--primary-light)'; timerEl.style.color = 'var(--primary)'; }
}

// Renderiza todas as perguntas de uma vez
function renderForm() {
  const container = document.getElementById('quiz-questions-container');
  container.innerHTML = '';

  questions.forEach((q, index) => {
    const block = document.createElement('div');
    block.className = 'question-block';
    block.style.background = 'var(--white)';
    block.style.padding = '20px';
    block.style.marginBottom = '20px';
    block.style.border = '1px solid var(--border)';
    block.style.borderRadius = 'var(--radius-sm)';
    
    const header = document.createElement('div');
    header.style.marginBottom = '16px';
    header.innerHTML = `<strong style="font-size: 16px; color: var(--dark);">${index + 1}. ${escapeHtml(q.question_text)}</strong>`;
    block.appendChild(header);

    if (q.image_url) {
      const img = document.createElement('img');
      img.src = q.image_url;
      img.style.width = '100%';
      img.style.maxWidth = '500px';
      img.style.borderRadius = '8px';
      img.style.marginBottom = '16px';
      img.style.display = 'block';
      img.style.border = '1px solid var(--border)';
      block.appendChild(img);
    }

    if (q.question_type === 'text') {
      const textarea = document.createElement('textarea');
      textarea.className = 'q-text-answer';
      textarea.placeholder = 'Digite sua resposta aqui...';
      textarea.dataset.qid = q.id;
      textarea.style.width = '100%';
      textarea.style.minHeight = '100px';
      textarea.style.padding = '12px';
      textarea.style.border = '1px solid var(--border)';
      textarea.style.borderRadius = '8px';
      textarea.style.fontFamily = 'inherit';
      textarea.style.resize = 'vertical';
      textarea.style.background = 'var(--bg)';
      textarea.style.color = 'var(--dark)';
      block.appendChild(textarea);
    } else {
      const optionsDiv = document.createElement('div');
      optionsDiv.className = 'options-list';
      
      q.options.forEach((opt, i) => {
        const label = document.createElement('label');
        label.className = 'option-btn';
        label.style.display = 'flex';
        label.style.alignItems = 'center';
        label.style.gap = '10px';
        label.style.cursor = 'pointer';
        label.style.padding = '12px';
        label.style.background = 'var(--bg)';
        label.style.border = '1px solid var(--border)';
        label.style.borderRadius = '8px';
        label.style.marginBottom = '8px';
        
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = `q-${q.id}`;
        radio.value = i;
        radio.dataset.qid = q.id;
        
        const span = document.createElement('span');
        span.textContent = opt;
        
        label.appendChild(radio);
        label.appendChild(span);
        
        radio.onchange = () => {
          const allLabels = optionsDiv.querySelectorAll('.option-btn');
          allLabels.forEach(l => {
            l.style.background = 'var(--bg)';
            l.style.borderColor = 'var(--border)';
          });
          label.style.background = 'var(--primary-light)';
          label.style.borderColor = 'var(--primary)';
        };
        
        optionsDiv.appendChild(label);
      });
      block.appendChild(optionsDiv);
    }
    
    container.appendChild(block);
  });
}

async function submitQuiz(event) {
  event.preventDefault();
  
  const btnSubmit = document.getElementById('btn-submit');
  btnSubmit.disabled = true;
  btnSubmit.textContent = 'Enviando...';

  let correctCount = 0;
  let totalAutoPoints = 0;
  let pendingTextCount = 0;
  let unanswered = 0;

  const submissionsToInsert = [];
  studentAnswers = []; // Limpa antes de preencher

  questions.forEach(q => {
    let isCorrect = false;
    let textAnswer = null;
    let selectedIndex = null;
    
    if (q.question_type === 'text') {
      const textarea = document.querySelector(`textarea[data-qid="${q.id}"]`);
      textAnswer = textarea ? textarea.value.trim() : '';
      if (!textAnswer) unanswered++;
      else pendingTextCount++;
    } else {
      const selectedRadio = document.querySelector(`input[name="q-${q.id}"]:checked`);
      if (!selectedRadio) {
        unanswered++;
      } else {
        selectedIndex = parseInt(selectedRadio.value);
        isCorrect = selectedIndex === q.correct_index;
        if (isCorrect) {
          correctCount++;
          totalAutoPoints += quiz.points_per_correct;
        }
      }
    }

    // Guarda na memória para desenhar o gabarito
    studentAnswers.push({
      question: q,
      selectedIndex: selectedIndex,
      textAnswer: textAnswer,
      isCorrect: isCorrect
    });

    submissionsToInsert.push({
      quiz_id: quiz.id,
      student_id: student.id,
      correct_answers: isCorrect ? 1 : 0,
      total_questions: 1,
      points_earned: isCorrect ? quiz.points_per_correct : 0,
      text_answer: q.question_type === 'text' ? (textAnswer || '(em branco)') : null,
      reviewed: q.question_type === 'text' ? false : true,
      started_at: new Date().toISOString()
    });
  });

  if (unanswered > 0) {
    if (!confirm(`Você deixou ${unanswered} pergunta(s) em branco. Deseja enviar mesmo assim?`)) {
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Enviar Respostas';
      return;
    }
  }

  const { error } = await supabaseClient.from('submissions').insert(submissionsToInsert);
  if (error) {
    showToast('Erro ao salvar: ' + error.message, 'error');
    btnSubmit.disabled = false;
    btnSubmit.textContent = 'Enviar Respostas';
    return;
  }

  if (totalAutoPoints > 0) {
    const { data: profile } = await supabaseClient.from('profiles').select('points').eq('id', student.id).single();
    await supabaseClient.from('profiles').update({ points: (profile?.points || 0) + totalAutoPoints }).eq('id', student.id);
  }

  showResult(correctCount, totalAutoPoints, pendingTextCount, unanswered);
}

function showResult(correctCount, points, pendingTextCount, unanswered) {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  
  document.getElementById('quiz-form').classList.add('hidden');
  const resultDiv = document.getElementById('quiz-result');
  resultDiv.classList.remove('hidden');

  const total = questions.length;
  const pct = total ? (correctCount / total) * 100 : 0;
  const timedOut = timeRemaining <= 0;

  let title, message;
  if (timedOut) {
    title = 'Tempo esgotado';
    message = `As respostas que você marcou foram enviadas.`;
  } else if (pendingTextCount > 0 && correctCount === 0) {
    title = 'Respostas enviadas';
    message = 'Suas respostas escritas foram enviadas para correção.';
  } else if (pendingTextCount > 0) {
    title = 'Concluído';
    message = `Você acertou ${correctCount} de ${total}. As respostas escritas serão avaliadas.`;
  } else if (pct >= 80) {
    title = 'Excelente';
    message = 'Você foi muito bem. Continue assim.';
  } else if (pct >= 50) {
    title = 'Bom trabalho';
    message = 'Você está no caminho certo.';
  } else {
    title = 'Continue tentando';
    message = 'Revise o conteúdo e tente de novo.';
  }

  document.getElementById('result-title').textContent = title;
  document.getElementById('result-message').textContent = message;
  document.getElementById('result-score-value').textContent = `${correctCount}/${total}`;
  document.getElementById('result-points').textContent = points;

  // ============================================
  // GABARITO (se o professor ativou)
  // ============================================
  const revisionContainer = document.getElementById('quiz-revision');
  if (quiz.show_results && revisionContainer) {
    revisionContainer.style.display = 'block';
    revisionContainer.innerHTML = '<h3 style="margin-bottom: 16px; color: var(--dark);">Gabarito e Revisão</h3>';
    
    studentAnswers.forEach((ans, index) => {
      const q = ans.question;
      const block = document.createElement('div');
      block.style.background = 'var(--white)';
      block.style.padding = '16px';
      block.style.marginBottom = '12px';
      block.style.border = '1px solid var(--border)';
      block.style.borderRadius = 'var(--radius-sm)';
      block.style.textAlign = 'left';

      let headerHTML = `<strong style="font-size: 15px; color: var(--dark);">${index + 1}. ${escapeHtml(q.question_text)}</strong>`;
      
      if (q.question_type === 'text') {
        block.innerHTML = `
          ${headerHTML}
          <div style="margin-top: 10px; font-size: 14px;">
            <p style="color: var(--gray); margin-bottom: 4px;">Sua resposta:</p>
            <div style="background: var(--bg); padding: 10px; border-radius: 6px;">${escapeHtml(ans.textAnswer || '(em branco)')}</div>
            <p style="color: var(--warning); margin-top: 8px; font-size: 12px;">Esta questão será avaliada pelo professor.</p>
          </div>
        `;
      } else {
        const statusColor = ans.isCorrect ? 'var(--success)' : 'var(--danger)';
        const statusText = ans.isCorrect ? 'Acertou' : 'Errou';
        
        let optionsHTML = '';
        q.options.forEach((opt, i) => {
          let bgColor = 'var(--bg)';
          let borderColor = 'var(--border)';
          let textColor = 'var(--dark)';
          let icon = '';

          if (i === q.correct_index) {
            bgColor = 'var(--success-light)';
            borderColor = 'var(--success)';
            textColor = 'var(--success)';
            icon = ' ✓';
          } else if (i === ans.selectedIndex && !ans.isCorrect) {
            bgColor = 'var(--danger-light)';
            borderColor = 'var(--danger)';
            textColor = 'var(--danger)';
            icon = ' ✗';
          }

          optionsHTML += `
            <div style="padding: 8px 12px; margin-top: 6px; border-radius: 6px; background: ${bgColor}; border: 1px solid ${borderColor}; color: ${textColor}; font-size: 14px;">
              ${String.fromCharCode(65 + i)}) ${escapeHtml(opt)}${icon}
            </div>
          `;
        });

        block.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
            ${headerHTML}
            <span style="font-size: 12px; font-weight: 600; color: ${statusColor}; background: ${statusColor}20; padding: 2px 8px; border-radius: 100px; white-space: nowrap; margin-left: 8px;">${statusText}</span>
          </div>
          ${q.image_url ? `<img src="${q.image_url}" style="max-width: 200px; border-radius: 6px; margin-bottom: 8px;">` : ''}
          ${optionsHTML}
        `;
      }

      revisionContainer.appendChild(block);
    });
  }
}