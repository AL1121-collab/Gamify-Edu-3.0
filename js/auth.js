// ============================================
// auth.js
// ============================================

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`${tab.dataset.tab}-form`).classList.add('active');
    document.getElementById('login-error').textContent = '';
    document.getElementById('signup-error').textContent = '';
  });
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';

  const btn = e.target.querySelector('button[type="submit"]');
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = 'Entrando...';

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('invalid login')) errEl.textContent = 'E-mail ou senha incorretos.';
      else if (msg.includes('email not confirmed')) errEl.textContent = 'E-mail não confirmado.';
      else if (msg.includes('rate limit')) errEl.textContent = 'Muitas tentativas. Aguarde.';
      else errEl.textContent = error.message;
      return;
    }

    let { data: profile } = await supabaseClient
      .from('profiles').select('role').eq('id', data.user.id).single();

    if (!profile) {
      const metaRole = data.user.user_metadata?.role || 'student';
      const metaName = data.user.user_metadata?.name || data.user.email?.split('@')[0] || 'Usuário';
      const { data: created } = await supabaseClient
        .from('profiles').insert({ id: data.user.id, name: metaName, role: metaRole, points: 0 })
        .select().single();
      profile = created;
    }

    window.location.href = profile?.role === 'teacher' ? 'teacher.html' : 'student.html';
  } catch (err) {
    console.error(err);
    errEl.textContent = 'Erro inesperado.';
  } finally {
    btn.disabled = false; btn.textContent = original;
  }
});

document.getElementById('signup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const role = document.querySelector('input[name="role"]:checked')?.value || 'student';
  const errEl = document.getElementById('signup-error');
  errEl.textContent = '';

  if (name.length < 2) { errEl.textContent = 'Digite seu nome completo.'; return; }
  if (password.length < 6) { errEl.textContent = 'Senha precisa ter no mínimo 6 caracteres.'; return; }

  const btn = e.target.querySelector('button[type="submit"]');
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = 'Criando conta...';

  try {
    const { data, error } = await supabaseClient.auth.signUp({
      email, password, options: { data: { name, role } }
    });

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('already registered')) errEl.textContent = 'Este e-mail já está cadastrado.';
      else if (msg.includes('rate limit')) errEl.textContent = 'Muitos cadastros. Aguarde.';
      else if (msg.includes('signups are disabled') || msg.includes('signups not allowed')) errEl.textContent = 'Cadastros desativados.';
      else errEl.textContent = error.message;
      return;
    }

    if (!data.user) { errEl.textContent = 'Não foi possível criar a conta.'; return; }

    await new Promise(r => setTimeout(r, 800));

    const { error: upsertErr } = await supabaseClient
      .from('profiles')
      .upsert({ id: data.user.id, name, role, points: 0 }, { onConflict: 'id' });

    if (upsertErr) { errEl.textContent = 'Conta criada, mas erro no perfil.'; return; }

    window.location.href = role === 'teacher' ? 'teacher.html' : 'student.html';
  } catch (err) {
    console.error(err);
    errEl.textContent = 'Erro inesperado.';
  } finally {
    btn.disabled = false; btn.textContent = original;
  }
});

(async function checkLoggedIn() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;
  const { data: profile } = await supabaseClient
    .from('profiles').select('role').eq('id', session.user.id).single();
  if (profile?.role === 'teacher') window.location.href = 'teacher.html';
  else if (profile?.role === 'student') window.location.href = 'student.html';
})();