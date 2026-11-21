---
# Every attribute form in one zine.
mustard: 1
title: 'Attributes: a "test" zine'
paper: a4
margin_mm: 8
look: night
---

::: page {#front layout=two-up bg=kraft}
## Side by side {#headline .big .loud by=hand tone=warm}
![Left](left.jpg){#left focus=0.25,0.75}
![Right](right.jpg){#right by=ai}
Two photos, one caption. {.place x=0.1 y=0.62 w=0.8 h=0.3 rot=-3}
:::

::: page {layout=back-cover}
The note comes first here. {slot=note locked=true}

And the body second.
:::

::: page {layout=headline-body}
# Many paragraphs
First paragraph.

Second paragraph,\
with a hard break.

Third paragraph. {#third-para}
:::

::: page {layout=photo-full}
A caption with no photo.
:::

::: page {layout=headline-body}
\# Not a heading, a body
:::

::: page {layout=freeform}
> A loose quote.

- loose
- list

![Free photo](free.jpg){.place x=0.2 y=0.2 w=0.4 h=0.3}
:::
