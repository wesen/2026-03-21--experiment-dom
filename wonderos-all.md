# WonderOS — Complete Site

> Fetched: 2026-03-22 | 3 pages

**Pages:**

- [WonderOS](https://wonderos.org/)
- [Hello, Operator!](https://wonderos.org/hello/)
- [WonderOS Poster](https://wonderos.org/poster/)

---

# WonderOS

> Source: [https://wonderos.org/](https://wonderos.org/)

An ongoing research project by [Alexander Obenauer](https://alexanderobenauer.com/).

---

### Software
Exploring an itemized user environment for modern personal computing devices

### Hardware
Exploring a personal computing network of new devices and services

### Society
Exploring how people attain computer literacy and evolve their systems

---

WonderOS is an ongoing research project exploring how the future of personal computing might substantially increase opportunity, agency, curiosity, and creativity.

There are many pieces to the puzzle of personal computing, and its operating systems, that need further exploration. My work focuses on the interfaces with which we think. As such, WonderOS experiments with future operator environments, of hardware both known and imagined.

More specifically, WonderOS experiments with an itemized operator environment. The item is an alternative boundary for our digital things which may let us interact with our devices more fluidly, and reflect our thinking more accurately, across our entire personal computing domain.

Items are separate from the interfaces that render them and the services that supply them, allowing operators to have the final say on how their systems work, how they interact with their things, and what services bring new items into their systems.

The entire system is composed of items, allowing it to think about well-known features in new ways. It can also be rearranged at will, in big ways and small. As a result, WonderOS has “operators” rather than “users” — in growing computer literacy, operators become able to use, modify, and evolve their systems.

This project is explorative, not prescriptive. The higher aim of this project is not the creation of some body of code or the proliferation of one set of ideas. The higher aim is to highlight the importance of asking the kinds of questions it asks, and to demonstrate that better answers await exploration; that if even these ideas represent improvement, then ones better still may lie ahead. This project is meant to help spark new and renewed thinking  about personal computing’s role in our lives and in society.

- [interfaces with which we think](https://alexanderobenauer.com)

#### Virtual machine & interface experiments

As this project progresses, it will generate a handful of different outputs. Here are the ones that have come out of the work so far:

The core WonderOS implementation is a virtual machine written in C and its own programming language, Wonderful. It uses the Item Store for its persistent storage, a chronological database of facts. Its implementation is covered in the Lab Reports.

WonderOS has gone through many iterations in prototype stage, with different experiments exploring different aspects of the system.

Its interface is explored in experiments that have been documented essays and lab notes. Its data model is based on the item store that appears in many of these experiments.

These WonderOS environments also serve as itemized testbeds for more specific or more divergent experiments. This is something an itemized environment does quite well: it makes wide experimentation easy. (Besides helping me in my explorative work, this suggests that it would help future operators of such systems evolve them for their own times and needs.)

One such experiment is OLLOS, which organizes your things on the dimension of time. It also experiments with a “spaced review” system that uses spaced repetition with items that you may want to pick back up on in the future.

Hello, Operator! is the operator’s handbook for WonderOS. It is presented as the manual that would come with the user’s first itemized personal computing device.

This handbook is an initial exercise in exploring how computer literacy might be attained by society at large with systems of this type, and how people might learn to use the core primitives of itemized, malleable systems to evolve them for their changing times and needs.

You can sign up for my newsletter on my website, where I'll send updates as the project progresses.

Early demos and works-in-progress are published in member updates, to members of the Little Lab. Finished experiments will be shared publicly over time.

- [Lab Reports](https://alexanderobenauer.com/#littlelab)
- [essays](https://alexanderobenauer.com/ollos/)
- [lab notes](https://alexanderobenauer.com/labnotes/000/)
- [item store](https://github.com/alexobenauer/Wonder)
- [OLLOS](https://alexanderobenauer.com/ollos/)
- [Hello, Operator!](https://wonderos.org/hello/)
- [on my website](https://alexanderobenauer.com/)
- [members of the Little Lab](https://alexanderobenauer.com/membership/)

A special thanks to Neil Krishnan and Steve Krouse (Val Town), sponsor-tier supporters; and to all the members of the Little Lab for helping to make this work possible.

Header photo by Lorenzo Herrera. Be sure to check out the linked Commodore PET project.

- [Val Town](https://www.val.town)
- [members of the Little Lab](https://alexanderobenauer.com/membership/)
- [Lorenzo Herrera](https://commodorepetmini.com)

---

**Links:**

- [Poster](https://wonderos.org/poster/)
- [Hello, Operator!](https://wonderos.org/hello/)


---

# Hello, Operator!

> Source: [https://wonderos.org/hello/](https://wonderos.org/hello/)

---

Part of the WonderOS project, this is presented as the operating manual that would come with the reader’s first machine running WonderOS.
        It is an exercise in exploring how people familiar with mainstream personal computing devices and systems would become computer literate in an itemized environment. It is written as though the reader is familiar with today’s mainstream operating systems, and is exploring their first itemized OS.

It is presented in some fragments; focusing on some core pieces that provide the most salient contrast to today's personal computing users.

- [WonderOS](https://wonderos.org/)

### Operator? Who… me?

When you go to a restaurant and eat a meal they’ve prepared, you’re a diner. But when you make a meal at home and eat it, although this accomplishes something similar, your role is very different. You aren’t a diner anymore; you’ve created and consumed the meal.

In software today, you’re either the developer or the user. The developer makes the software. It works one way, maybe with some settings to work a little bit differently. The user uses the software, conforming to its best practices and intended workflow.

Similar to the role shift when you cook a meal and eat it, there’s a role shift away from “user” that happens when your OS is made of core primitives which you can modify and recompose. In this role, these “user-developers” are operators of their machines, as they once were in the first few decades of computing. But you won’t be building your system all day; it will grow with you as you use it. In this handbook, you’ll learn how we’ve set it up to get you started. And when you decide something could be changed to support your best work, you will be able to make that change.
      ⊕
      
      In this handbook, we’ll also teach you how to make these kinds of changes to your system. Rather than some more-complicated process, it only takes knowing the same fundamentals of itemized computing that you’ll learn to use your new computer.
      

      With your new system, you are now the operator.

So: Hello, Operator!

Welcome to your new operating system. This is truly personal computing, which you can adapt to support your best life and work.

We hope it gives you the same sense of wonder that we felt when we flicked on our first personal computers decades ago.

### Items: The basic building blocks

Just as our thoughts and languages are structured around things and actions, our itemized OS is too.
      This lets us interact with our devices more fluidly, and model our thinking more accurately. We’ll cover actions in a few chapters, and focus on things in this one.

In the itemized OS, our things are items. In fact, everything in the itemized OS is an item. A todo list is an item, and so are the todos in it. An email is an item, and so is the contact of the person who sent it to you. Even the day’s weather forecast is an item, which gets updated often as the day approaches.

For those coming from window, desktop, and app-based OSs, one of the early surprises about items is their mobility: you can take an item from one place and put it somewhere else; or you can have it in both places — something that you will find is very common in the itemized OS.

Take the todo list, for example. Say we have a todo list for a project, and one of the todos on it is assigned to a date. In this case, we have an item (our todo) which is “in” two places at once: it’s in the project todo list item and the date item. When it appears in one place, it can also show us the other place it can be found; this lets us see an assigned date when we’re in the project, or see the project this task progresses when we’re looking at the date.

### Workspaces

In a desktop-based OS, you often have the things you need for all of your day’s tasks open as windows in one or more desktops. Even if you’ve committed yourself to arranging the windows and desktops you need with precision, you have to repeat this work whenever you need to continue the task at hand; every time your system restarts, so do all of your personal processes of arranging your things and managing your workspace.

In the itemized environment, you open the things you need to do something within an overarching item, and you can always return to that item and its contents. That item might simply be the todo or project item you’re working on, or it might be a new item — one you might discard once you’re done with a one-time task, or one which you might save within a larger project when you’re working on something you’d like to return to in the future. Either way, the important thing to know is that you can always return to continue work you were handling in a recent workspace, and all the items that were in it return too.

### Notifications, and your locus of focus

There are many kinds of things we may want to stay updated on throughout the day: new messages from a close colleague or loved one, upcoming meetings and any changes to them, or what song is currently playing from the speakers on our device or network.

In the itemized environment, you control what kinds of things can interrupt you with a notification, and you define it by what’s on your screen. An upcoming event in your system bar will show a received email from one of its participants. A website that you’re attempting to log in to will show an email you receive with the confirmation code or login link. Keeping a contact item of a colleague or loved one in your system bar will ensure you always see new messages from them (plus, it will give you easy access to sending them a new message or other item).

You have a clear, visually-defined focus at all times, which often assembles as a result of the work you’ve already done in simply managing your workspace and going about your day.

### Keeping organized

Much of the context and connections among your items happens as a byproduct of your natural actions: adding tasks to a list creates a relationship between the list and its tasks, just as assigning a date to one of the tasks creates a relationship between the date and the task; opening a task as your workspace creates a relationship between the task and the items you go on to use as you work on it, and it creates shared context among those items; simply taking an action on any item gives it some context at that time and on that date, shared with anything else happening then, such as a meeting with a colleague.

Some people prefer to meticulously organize their things, while others like to simply use their itemized system however feels natural and make use of orienteering to find things later, as we saw in an earlier chapter. The itemized OS is great for both: with its capabilities for rich expression of items and relationships, you can reflect your thinking in high fidelity, or you can quickly search and browse your way to needed items via the connections made from paths you’ve taken before.

### (Re-)Composing your system

You have control over the components in your operating system, and how they’re composed. You have control over what service your system uses to sync emails to your local device, what interfaces render your inbox, your message views, and your drafts. You can swap views on-the-fly, and freely use any views you wish with any items — like a Markdown editor for your email drafts, or a unified inbox for your messages. You can compose your items together to reflect your thinking, like having an email thread connected to a related event item and a webpage item; and these connections can be a byproduct of how you navigate your system, or they can be made manually.

But you also have control over how all these items are arranged to form the very features of your system. So far, this handbook has covered how we composed this system and its features before we sent it to you.

In the next few chapters, we will explore some ways you can recompose your system — with the skills you’ve already learned from this handbook.

### Now, it’s your turn

As the operator, now equipped with the knowledge of how to assemble mere items into whole systems, it is now your turn.

You see, everything we have presented in this handbook is simply the set of features of the system as we shipped it to you. But the whole point of this game is to evolve it as you play it, and to share it on. Nothing described in this handbook is meant to be prescriptive. (In fact, some opposing or alternate concepts were presented!) Rather, we’ve put together and presented these concepts simply as a good starting point. You now have the power to lead the charge, alongside any other wonderers and tinkerers out there, to evolve these systems according to the present needs and best ideas.

That’s what we most hope to share with you. Above all else, we hope you take away a style of thinking about personal computing and technology from this handbook, moreso than any specific utilizations described herein. (Though we do hope some specific utilizations inspire you to see the value of this style of thinking!)

People should have sovereignty over their hardware, software, and data. By adopting this system, and by evolving it and passing it on to others, you’re helping esure that people always have access to truly personal computing. Tinkerers — from the past and the future — thank you for taking that charge, and for passing it on.

---

**Links:**

- [Operator? Who… me?](#whome)
- [Items: The basic building blocks](#items)
- [Item Views](#views)
- [Workspaces](#workspaces)
- [Notifications, and your locus of focus](#notifications)
- [Keeping organized](#organize)
- [(Re-)Composing your system](#composure)
- [Now, it’s your turn](#yourturn)
- [Poster](https://wonderos.org/poster/)
- [Hello, Operator!](https://wonderos.org/hello/)


---

# WonderOS Poster

> Source: [https://wonderos.org/poster/](https://wonderos.org/poster/)

The WonderOS poster

---

## The WonderOS poster

18” × 24”

10 mil thick, 260 g/m²

Slightly glossy

Fingerprint resistant

Paper sourced from Japan

Free worldwide shipping

Free shipping


---

*Source: [wonderos.org](https://wonderos.org/)*