async function requireAuth(role) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return null; }

  let { data: profile } = await supabaseClient.from('profiles').select('*').eq('id', session.user.id).single();

  if (!profile) {
    const metaRole = session.user.user_metadata?.role || 'student';
    const metaName = session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'Usuário';
    const { data: created } = await supabaseClient.from('profiles').insert({ id: session.user.id, name: metaName, role: metaRole, points: 0 }).select().single();
    profile = created || { id: session.user.id, name: metaName, role: metaRole, points: 0 };
  }

  if (role && profile.role !== role) {
    const metaRole = session.user.user_metadata?.role;
    if (metaRole === role) {
      const { error } = await supabaseClient.from('profiles').update({ role }).eq('id', session.user.id);
      if (!error) profile.role = role;
    } else {
      window.location.href = profile.role === 'teacher' ? 'teacher.html' : 'student.html';
      return null;
    }
  }
  return { session, profile };
}

async function logout() { await supabaseClient.auth.signOut(); window.location.href = 'login.html'; }
function toggleSidebar() { document.getElementById('sidebar')?.classList.toggle('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('active'); }

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  const bg = type === 'error' ? '#DC2626' : '#059669';
  toast.style.cssText = `position:fixed;top:20px;right:20px;background:${bg};color:white;padding:12px 20px;border-radius:10px;font-weight:500;font-size:14px;z-index:9999;box-shadow:0 10px 30px rgba(0,0,0,0.15);max-width:320px;`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

function generateRoomCode() { return Math.random().toString(36).substring(2, 8).toUpperCase(); }
function formatDate(date) { return new Date(date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }); }
function formatTime(date) { return new Date(date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
function escapeHtml(str) { return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

function setupNavigation() {
  document.querySelectorAll('.side-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const view = link.dataset.view;
      document.querySelectorAll('.side-link').forEach(l => l.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      link.classList.add('active');
      document.getElementById(`view-${view}`)?.classList.add('active');
      document.getElementById('view-title').textContent = link.textContent.trim();
      if (window.innerWidth < 768) document.getElementById('sidebar')?.classList.remove('open');
      if (window.onViewChange) window.onViewChange(view);
    });
  });
}

async function uploadAvatar(file, userId) {
  const ext = file.name.split('.').pop().toLowerCase();
  const filePath = `${userId}/avatar.${ext}`;
  const { error: uploadError } = await supabaseClient.storage.from('avatars').upload(filePath, file, { upsert: true, contentType: file.type });
  if (uploadError) throw uploadError;
  const { data } = supabaseClient.storage.from('avatars').getPublicUrl(filePath);
  const publicUrl = data.publicUrl + '?t=' + Date.now();
  const { error: updateError } = await supabaseClient.from('profiles').update({ avatar_url: publicUrl }).eq('id', userId);
  if (updateError) throw updateError;
  return publicUrl;
}

function renderAvatar(profile, size = 40, isTeacher = false) {
  let avatarHtml = '';
  if (profile?.avatar_url) {
    avatarHtml = `<img src="${profile.avatar_url}" alt="${escapeHtml(profile.name || '')}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;flex-shrink:0;border:1px solid var(--border);">`;
  } else {
    const letter = (profile?.name || '?').charAt(0).toUpperCase();
    avatarHtml = `<div style="width:${size}px;height:${size}px;border-radius:50%;background:var(--primary-light);color:var(--primary);display:flex;align-items:center;justify-content:center;font-weight:600;font-size:${Math.round(size * 0.42)}px;flex-shrink:0;">${letter}</div>`;
  }
  if (isTeacher) {
    return `<div class="avatar-wrapper"><div class="crown-badge">👑 Professor</div>${avatarHtml}</div>`;
  }
  return avatarHtml;
}

const CHART_COLORS = ['#4F46E5', '#0891B2', '#059669', '#D97706', '#DC2626', '#7C3AED', '#DB2777', '#0D9488', '#EA580C', '#475569'];

function renderBarChart(data, options = {}) {
  if (!data.length) return `<div class="empty-state">Sem dados ainda</div>`;
  const max = Math.max(...data.map(d => d.value), 1);
  const showAvatars = options.showAvatars !== false;
  return `<div class="bar-chart">
    ${data.map((d, i) => {
      const pct = (d.value / max) * 100;
      return `<div class="bar-row">
        <div class="bar-rank">${i + 1}</div>
        ${showAvatars ? `<div class="bar-avatar">${renderAvatar(d.profile, 32)}</div>` : ''}
        <div class="bar-main">
          <div class="bar-label"><span class="bar-name">${escapeHtml(d.label)}</span><span class="bar-value">${d.value}${options.suffix || ''}</span></div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${CHART_COLORS[i % CHART_COLORS.length]};"></div></div>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function renderPieChart(data, size = 240) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return `<div class="empty-state">Sem dados ainda</div>`;
  const radius = size / 2 - 8;
  const innerRadius = radius * 0.58;
  const cx = size / 2, cy = size / 2;
  let startAngle = -Math.PI / 2;
  const slices = [];
  data.forEach((d, i) => {
    const angle = (d.value / total) * 2 * Math.PI;
    const endAngle = startAngle + angle;
    const x1 = cx + radius * Math.cos(startAngle), y1 = cy + radius * Math.sin(startAngle);
    const x2 = cx + radius * Math.cos(endAngle), y2 = cy + radius * Math.sin(endAngle);
    const x3 = cx + innerRadius * Math.cos(endAngle), y3 = cy + innerRadius * Math.sin(endAngle);
    const x4 = cx + innerRadius * Math.cos(startAngle), y4 = cy + innerRadius * Math.sin(startAngle);
    const largeArc = angle > Math.PI ? 1 : 0;
    const path = `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${x4} ${y4} Z`;
    slices.push(`<path d="${path}" fill="${CHART_COLORS[i % CHART_COLORS.length]}" stroke="var(--white)" stroke-width="1.5"/>`);
    startAngle = endAngle;
  });
  return `<div class="pie-wrap">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${slices.join('')}
      <text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="20" font-weight="600" fill="var(--dark)">${total}</text>
      <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="11" fill="var(--gray)">acertos</text>
    </svg>
    <div class="pie-legend">${data.map((d, i) => `<div class="pie-legend-item"><span class="pie-dot" style="background:${CHART_COLORS[i % CHART_COLORS.length]};"></span><span class="pie-label">${escapeHtml(d.label)}</span><span class="pie-value">${d.value} <span class="pie-pct">(${Math.round(d.value / total * 100)}%)</span></span></div>`).join('')}</div>
  </div>`;
}

function initTheme() {
  const savedTheme = localStorage.getItem('gamify-theme');
  if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.setAttribute('data-theme', 'dark'); updateThemeIcon('dark');
  } else {
    document.documentElement.setAttribute('data-theme', 'light'); updateThemeIcon('light');
  }
}
function toggleTheme() {
  const newTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('gamify-theme', newTheme); updateThemeIcon(newTheme);
}
function updateThemeIcon(theme) { document.querySelectorAll('.theme-icon').forEach(icon => icon.textContent = theme === 'dark' ? '☀️' : '🌙'); }
initTheme();