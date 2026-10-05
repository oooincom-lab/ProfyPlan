/**
 * Роли пользователя в организации (блок 6.34 «Аккаунты, организации и доступы»).
 * Один источник подписей для интерфейса: вход, выбор компании, «Команда», приглашения.
 * Регистр роли в хранилище не гарантирован («Planner» / «planner») — сравниваем без регистра.
 */
export function roleLabel(role?: string | null): string {
  switch ((role || '').toLowerCase()) {
    case 'owner': return 'Владелец';
    case 'admin': return 'Администратор';
    case 'planner': return 'Планировщик';
    case 'viewer': return 'Наблюдатель';
    default: return '';
  }
}
