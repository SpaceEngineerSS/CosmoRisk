# Contributing to Orbital Sentinel

Thank you for your interest in contributing to Orbital Sentinel! This document provides guidelines for contributing.

## 🚀 Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/CosmoRisk.git
   ```
3. **Create a branch** for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   ```

## 📋 Development Setup

### Prerequisites
- Node.js v18+
- Rust 1.70+
- Tauri CLI

### Running Locally
```bash
npm install
npm run tauri dev
```

### Running Tests
```bash
# Rust tests
cd src-tauri && cargo test

# TypeScript type check
npm run build
```

## 🔧 Code Guidelines

### Rust (Backend)
- Follow Rust conventions (`rustfmt`, `clippy`)
- Document public functions with `///` comments
- Use SI units internally (meters, seconds, kilograms)
- Add unit tests for physics calculations

### TypeScript (Frontend)
- Use TypeScript strict mode
- Follow existing code style
- Document complex functions

## 📐 Physics Contributions

When adding new physics effects:

1. **Reference Literature**: Cite academic sources
2. **Document Formulas**: Add LaTeX comments
3. **Add Unit Tests**: Validate against known solutions
4. **Update README**: Add to Scientific Methodology section

## 🐛 Bug Reports

When reporting bugs, include:
- Operating system and version
- Steps to reproduce
- Expected vs actual behavior
- Console error messages

## ✨ Feature Requests

Before suggesting new features:
- Check existing issues
- Explain the use case
- Consider if it fits the project scope

## 📝 Pull Request Process

1. Update documentation if needed
2. Add/update tests
3. Ensure all tests pass
4. Update CHANGELOG if applicable
5. Request review from maintainers

## 📜 Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Focus on the code, not the person
- Follow GitHub community guidelines

## 📄 License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for helping make Orbital Sentinel better! 🌟
