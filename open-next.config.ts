import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({
  // Optional: enable R2 incremental caching if you configure NEXT_INC_CACHE_R2_BUCKET in wrangler.jsonc
  // See https://opennext.js.org/cloudflare/caching
});
