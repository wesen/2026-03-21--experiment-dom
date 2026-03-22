# alexobenauer/Wonder

25 stars | 2 watching | 5 commits | branch: `main` | created: 2024-02-12

Languages: **Swift** 69.1%, **C** 30.9%

Source: [https://github.com/alexobenauer/Wonder](https://github.com/alexobenauer/Wonder)

---

## File Tree

```
📁 ItemStore - C
📁 ItemStore - Swift
📁 Wonder.xcodeproj
📁 Workbench
📄 .gitattributes
📄 .gitignore
📄 README.md
```

---

## README

### Table of Contents

- Workbench
  - Items & the item store
    - Insert facts
    - Create items
    - Relate items
    - Fetch facts
    - Fetch facts by value range
    - Fetch facts by insertion timestamp
    - Overfetching & efficient queries
    - Delete facts
    - Delete items
    - Item drives
  - Building new things in Workbench
  - Providers
    - Use resource drives
    - In-memory drives
  - Apps
    - Subscribers
    - Subscriber helpers
    - View components
    - Item views
    - Apps are item views
  - Contribute

### Summary

There are a handful of projects within Wonder.xcodeproj; the first are the Workbench app and the item store, described here:

Personal interfaces dev kit

With Workbench, you can build and use your own personal, itemized interfaces like the ones in my experiments (OLLOS, and Tag Navigator) and lab notes.

Workbench runs as a native app on Mac, iPad, iPhone, and other Apple devices, and syncs data automatically via iCloud.

In it, you can build providers, which bring items into your item store from external sources, and apps, which are the interfaces you'd like to use with your items — creating, reviewing, and modifying them. You can also build new item views, for new and existing item types, which are provided to existing apps and other views (this is a simple way to extend interfaces in Workbench, adding new functionality to existing items and views).

*... 103 more paragraphs, 26 code blocks*

### Links

- [OLLOS](https://alexanderobenauer.com/ollos/)
- [Tag Navigator](https://alexanderobenauer.com/labnotes/exp001/)
- [lab notes](https://alexanderobenauer.com/labnotes/000/)

---

*Fetched: 2026-03-22*