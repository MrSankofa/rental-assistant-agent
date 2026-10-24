{ pkgs }: {
  deps = [
    # Node 22 provides native fetch, crypto.randomUUID and modern JavaScript syntax.
    pkgs.nodejs_22
    pkgs.nodePackages.typescript-language-server
  ];
}
