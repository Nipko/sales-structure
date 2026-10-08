---
id: herramientas-tipo-negocio
title: "Agent tools for your business type"
routes: ["/admin/agent", "/admin/agent/quality", "/admin/memberships"]
roles: ["tenant_admin"]
keywords: ["tools","capabilities","industry","business type","subtype","tool families","what can the agent do","waitlist","enable tools","disabled tool","agent setup","example price","confirm price","quoted per case","memberships","membership plans","gym"]
---

# Agent tools for your business type

The **industry** groups businesses; the **business type** defines their actual operations. A hotel and a tour agency both belong to tourism, but need different catalogues, availability and booking records. Set the account's actual business type before selecting tools.

Under **AI Agent → Capabilities**, review the families that apply to that business type. An older configuration may retain a family that no longer applies: you can disable it, but enabling it does not expand the agent's authority. If profile or plan information is unavailable, wait or refresh; that state is not permission.

## What capabilities each business type brings

**FAQs** are available for every business type. The other capabilities depend on the type you chose at sign-up; they appear under these names in **AI Agent → Capabilities**, in the **Industry tools** section:

- **Healthcare** — Dental, Dermatology & aesthetic medicine, Psychology & therapy: Appointment Scheduling, Treatment plans. General medicine: Appointment Scheduling. Pharmacy: Product catalog.
- **Beauty & aesthetics** — Beauty salon, Barbershop: Appointment Scheduling. Spa & wellness, Aesthetics center: Appointment Scheduling, Treatment plans.
- **Real estate** — Property sales, Rental, Commercial real estate: Appointment Scheduling, Real estate.
- **Restaurants / Food** — Casual dining, Coffee shop: Appointment Scheduling, Restaurant. Fast food, Dark kitchen / Delivery: Restaurant.
- **Automotive** — Dealership: Appointment Scheduling, Vehicles. Auto repair shop: Appointment Scheduling, Workshop orders. Parts & accessories: Product catalog. Car rental: Vehicles, Vehicle rentals.
- **Tourism** — Travel agency, Tours & activities: Tours & packages. Hotel / Hostel, Vacation rental: Properties (vacation rental).
- **Education** — Language school, University / College, Online courses, Corporate training, Dance academy, Music or art academy, Private lessons and tutoring, Driving school: Appointment Scheduling, Education.
- **Finance / Banking** — Financial advisory, Loans & credit: Appointment Scheduling.
- **Professional services** — Lawyers, Accountants, Architects, Consultants: Appointment Scheduling, Case status.
- **Retail / Commerce** — Fashion & clothing, Electronics: Product catalog. Home & decor: Product catalog, Appointment Scheduling.
- **Technology** — SaaS, Software development: Appointment Scheduling. Hardware & networking: Product catalog.
- **Veterinary** — Small animal clinic, 24h veterinary hospital, Exotic animals: Appointment Scheduling, Veterinary.
- **Gyms & Fitness** — Traditional gym, CrossFit box, Yoga / pilates studio, Cycling / spinning, Martial arts: Appointment Scheduling, Gym.
- **Insurance** — Broker, Life insurance specialist, Auto insurance specialist: Insurance.
- **Home services** — Plumbing, Electrical, Pest control, Cleaning, Landscaping, Locksmith, Painting: Home services.
- **Pet services** — Pet grooming, Dog walking, Training: Appointment Scheduling, Pet services, Veterinary. Day care, Pet hotel: Pet services, Veterinary, Daycare and boarding.
- **Photography / Events** — Photo studio, Wedding photography, Social & corporate events, Product photography: Photography.
- **Other** — Product catalog.

What each capability does:

- **Appointment Scheduling**: checks services and availability, creates, reschedules and cancels appointments, lists the customer's appointments and sends the booking link.
- **Product catalog**: searches products, shows their details and image, checks stock, and takes, looks up and cancels catalogue orders.
- **Treatment plans**: looks up the customer's treatment plan and upcoming sessions.
- **Real estate**: searches listings and shows their details and images.
- **Restaurant**: shows the menu and promotions, takes orders, checks their status, cancels them and lists the customer's orders.
- **Vehicles**: searches vehicles, shows their details and images and schedules test drives (the latter also needs Appointment Scheduling).
- **Workshop orders**: opens, looks up and cancels repair orders, and records whether the customer approves or rejects the current estimate. It records what the customer reports; it does not diagnose.
- **Vehicle rentals**: checks availability and creates, looks up and cancels rentals.
- **Tours & packages**: searches packages, shows their details and availability, and creates, lists or cancels tour bookings.
- **Properties (vacation rental)**: lists accommodations, checks availability and details, gives check-in instructions, and creates, lists or cancels bookings.
- **Education**: looks up courses and schedules, enrols students, shares the placement-test link and cancels enrolments.
- **Case status**: looks up the status of a case. It is read-only: it does not create or quote cases.
- **Gym**: looks up membership plans and the class schedule, books and cancels classes, and looks up or freezes the customer's membership.
- **Insurance**: looks up plans, calculates quotes, checks a policy's status, files and lists claims, and cancels quotes.
- **Home services**: lists services and availability, creates service requests, checks their status and cancels them.
- **Veterinary**: manages the customer's pet records, checks vaccination status and classifies how urgent an emergency is so it can be handed to the team.
- **Pet services**: lists the services and checks daycare availability.
- **Daycare and boarding**: creates, looks up and cancels pet stays.
- **Photography**: lists packages, sends the portfolio, checks a date's availability, requests a quote and cancels sessions.

The 8 **waitlisted** business types (Wedding planning, General contractor, Property developer, Payments & collections, Marketplace / E-commerce, IT support & MSP, Insurance carrier and Health insurance specialist in insurance) are not offered at sign-up and their full operation is still closed; do not expect the agent to complete operations specific to those businesses. The 5 types that exist only for earlier accounts (Construction & development, Fintech, IT Consulting, Pet grooming under veterinary, and Wedding planner) keep working for the accounts that already had them. The full list of modules per industry is in the article **Tools and modules for your industry**.

## Configure around a task

1. Define what the agent should accomplish and when your team should take over.
2. Enable the tools required for those tasks. Enabling every tool is unnecessary.
3. Complete each tool's records in its module: products, menu, services, capacity, courses or other business data. Some businesses use **Packages & services** without a time-slot calendar.
4. Review individual permissions: checking availability, creating, cancelling, recommending and creating payment links are different actions.
5. Save and refresh the agent assessment. It reads preparation again; an enabled option does not guarantee the required data or connection exists.
6. Test a complete task, including missing information, a refusal and the final result. Review every connection the agent will serve.

## What availability means

Permission depends on business type, agent configuration, the current plan, prepared data and provider status where relevant. The assessment should explain missing capabilities and point to the screen that fixes them. Connecting an integration does not replace agent permissions.

If another system owns bookings or orders, reading its data does not mean Parallly can confirm an operation in that system. Hand over to the team when no authorized, verified write path exists.

An enabled tool is configured. A prepared tool meets known requirements. A tested task requires result evidence for the relevant profile, version and channel. A conversation example or a test that only asks for missing information does not prove that a booking or order was created.

## Prices the agent doesn't state yet

Your industry recipe pre-fills example prices so you don't start from zero, and the agent doesn't state them to your customers until you confirm them. That applies to services (see **Appointments and calendars**) and, for a gym, also to **membership plans**:

- Under **Memberships**, each plan with an example price shows the **Example price** pill and a note that the agent won't mention it until you confirm it. **Confirm price** keeps the same amount, now confirmed; **Quoted per case** makes the agent state no amount for that plan and offer to have a person quote it.
- A plan that shows **No price** has no amount to confirm: press **Enter price**, **It's free** or **Quoted per case**.
- In the plan form you pick **Confirmed price** (needs an amount above 0), **It's free** or **Quoted case by case**; typing a different amount also confirms it. A free plan shows as **Free**, and the agent tells customers it's free.
- While any is still unconfirmed or has no price, **Agent health** shows the non-critical **Unconfirmed prices** warning; the agent keeps answering.

## How Assist helps

Ask Assist to review the agent's mission and tools, explain a blocker and open its configuration. Assist should use the account's current assessment. When a guided operation supports your role, review the proposal and change before applying it; a tour alone does not save changes.

Your business knowledge base, FAQs and policies inform customer answers. This Assist help explains the platform. Uploading a document does not guarantee that a product, FAQ or service was created in the record a tool reads.

If a task is unverified, complete its pending test. Changing the mission or tone does not resolve a missing tool or an operation that still needs your team.

