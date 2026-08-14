const USERS_KEY = 'skillbridge_admin_users'

export const getRegisteredUsers = () => {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) || '[]')
  } catch {
    return []
  }
}

export const saveRegisteredUsers = (users) => {
  localStorage.setItem(USERS_KEY, JSON.stringify(users))
}

export const addRegisteredUser = (user) => {
  const users = getRegisteredUsers()
  const next = [user, ...users]
  saveRegisteredUsers(next)
  return next
}
