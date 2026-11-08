/** Where each role lands after signing in, and where it's sent from pages it doesn't use. */
export const workspacePath = (role: string) => role === "rep" ? "/rep" : role === "vendor" ? "/vendor" : "/ops";
