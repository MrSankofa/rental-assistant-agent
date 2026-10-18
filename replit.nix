{ pkgs }: {
  deps = [
    # Node 20 provides native fetch, crypto.randomUUID and modern JavaScript syntax.
    pkgs.nodejs-20_x
    pkgs.nodePackages.typescript-language-server
  ];
}
