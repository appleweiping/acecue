// Sample résumé, job description and answer for the one-click demo.
// The person and the company are made up.

export const SAMPLE_RESUME = `Alex Chen - B.S. Computer Engineering, expected May 2028
University of Minnesota, Twin Cities. GPA 3.6.

Experience
- Teaching assistant, Intro to Programming (Python), Fall 2026. Ran two lab sections of 25 students; wrote an autograder test suite for weekly labs.
- Software intern, campus IT help desk, Summer 2026. Built a small Flask dashboard that groups support tickets by topic.

Projects
- Bus arrival notifier: Python script that polls the Metro Transit API and texts me when my bus is 5 minutes away.
- 8-bit CPU in Verilog for a digital design course; simulated in Icarus Verilog, ran on a Basys 3 FPGA.

Skills
Python, C, Verilog, Git, SQL, Linux, Flask.`;

export const SAMPLE_JD = `Northwind Robotics - Software Engineering Intern (Summer 2027)

You will join the fleet tools team, which builds internal services that monitor our warehouse robots.

What you will do
- Write and test Python services that collect telemetry from robots.
- Build small web dashboards for operations staff.
- Investigate bugs reported from the warehouse floor and fix them.

What we look for
- Comfortable with Python and Git; some web or SQL experience.
- Can explain technical choices to non-engineers.
- Takes ownership of a problem from report to fix.`;

export const SAMPLE_QUESTION = "Tell me about a time you had to learn something new quickly.";

export const SAMPLE_ANSWER = `Last summer I was interning at the campus IT help desk. My manager asked me to build a dashboard that groups support tickets by topic, but I had never used Flask or done any web development, and I had about two weeks before the team demo.

I started by doing the official Flask tutorial in the first two days, and then I built the smallest possible version: one page that read the ticket export and showed a table. I asked a senior student worker to review my code every evening, which helped me fix things like how I was loading the data. After that I added the grouping by topic using simple keyword rules, and I wrote a few tests so I would notice if a change broke the counts.

In the end I demoed it on time and the team started using it in their weekly meeting. I think it went pretty well and I learned a lot about how to break a new tool into small steps.`;
