-- Neovim (>= 0.8): starts the Drax language server for *.dx buffers.
-- Usage in init.lua:  require('drax.lsp').setup()
local M = {}

function M.setup(opts)
  opts = opts or {}
  local root_dir = debug.getinfo(1, 'S').source:sub(2):match('(.*)/vim/lua/drax/lsp.lua$')
  local cmd = opts.cmd or { (root_dir or '.') .. '/server/bin/drax-language-server', '--stdio' }

  vim.api.nvim_create_autocmd('FileType', {
    pattern = 'drax',
    callback = function(args)
      local file = vim.api.nvim_buf_get_name(args.buf)
      local root = vim.fs.dirname(vim.fs.find({ 'lib', '.git' }, { upward = true, path = file })[1] or file)
      vim.lsp.start({ name = 'drax', cmd = cmd, root_dir = root })
    end,
  })
end

return M
