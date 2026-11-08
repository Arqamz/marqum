export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      2,
      "always",
      ["core", "parsers", "schema", "api", "web", "android", "config", "repo", "ci", "deps", "docs"],
    ],
    "body-max-line-length": [0],
    "subject-case": [0],
  },
};
