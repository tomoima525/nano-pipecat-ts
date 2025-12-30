/// <reference types="vite/client" />

// Declare module for Vite's ?url imports
declare module "*?url" {
  const url: string;
  export default url;
}
