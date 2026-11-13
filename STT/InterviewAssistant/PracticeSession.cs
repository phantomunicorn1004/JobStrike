namespace InterviewAssistant;

public sealed class PracticeQuestion
{
    public string Text { get; set; } = "";
    public InterviewType RoundType { get; set; }
    public string Category { get; set; } = "";
}

public sealed class PracticeResult
{
    public string Question { get; set; } = "";
    public string UserAnswer { get; set; } = "";
    public string Feedback { get; set; } = "";
    public string FollowUp { get; set; } = "";
    public int Score { get; set; }
}

public sealed class PracticeSession
{
    public InterviewType RoundType { get; set; }
    public List<PracticeQuestion> Questions { get; set; } = [];
    public List<PracticeResult> Results { get; set; } = [];
    public int CurrentIndex { get; set; }

    public PracticeQuestion? Current => CurrentIndex < Questions.Count ? Questions[CurrentIndex] : null;
    public bool IsComplete => CurrentIndex >= Questions.Count;
    public int TotalQuestions => Questions.Count;

    public double AverageScore => Results.Count > 0 ? Results.Average(r => r.Score) : 0;

    public static PracticeSession Create(InterviewType type, int count = 5)
    {
        var all = QuestionsFor(type);
        var rng = new Random();
        var picked = all.OrderBy(_ => rng.Next()).Take(Math.Min(count, all.Count)).ToList();
        return new PracticeSession { RoundType = type, Questions = picked };
    }

    static List<PracticeQuestion> QuestionsFor(InterviewType type) => type switch
    {
        InterviewType.Screening => [
            Q("Tell me about yourself.", "Intro"),
            Q("Why are you interested in this role?", "Motivation"),
            Q("What do you know about our company?", "Research"),
            Q("What are your salary expectations?", "Logistics"),
            Q("When can you start?", "Logistics"),
            Q("Why are you looking for a new opportunity?", "Motivation"),
            Q("Walk me through your resume.", "Intro"),
            Q("What's your ideal work environment?", "Culture"),
            Q("Are you interviewing anywhere else?", "Logistics"),
            Q("Do you have any questions for me?", "Closing"),
        ],
        InterviewType.Behavioral => [
            Q("Tell me about a time you had a conflict with a coworker.", "Conflict"),
            Q("Describe a project you led from start to finish.", "Leadership"),
            Q("Give an example of when you failed and what you learned.", "Growth"),
            Q("Tell me about a time you had to meet a tight deadline.", "Pressure"),
            Q("Describe a situation where you had to persuade someone.", "Influence"),
            Q("Tell me about a time you went above and beyond.", "Initiative"),
            Q("Give an example of working with a difficult stakeholder.", "Collaboration"),
            Q("Describe a time you had to make a decision with incomplete information.", "Judgment"),
            Q("Tell me about a time you received critical feedback.", "Growth"),
            Q("Give an example of when you improved a process.", "Impact"),
        ],
        InterviewType.Technical => [
            Q("Explain the difference between REST and GraphQL.", "API"),
            Q("How would you handle a slow database query in production?", "Performance"),
            Q("What's the difference between horizontal and vertical scaling?", "Architecture"),
            Q("Explain how you'd implement authentication in a web app.", "Security"),
            Q("What are microservices and when would you use them?", "Architecture"),
            Q("How do you approach debugging a production issue?", "Debugging"),
            Q("Explain the CAP theorem and its practical implications.", "Distributed"),
            Q("What's your approach to code reviews?", "Process"),
            Q("How do you ensure code quality in your projects?", "Quality"),
            Q("Describe your experience with CI/CD pipelines.", "DevOps"),
        ],
        InterviewType.SystemDesign => [
            Q("Design a URL shortener like bit.ly.", "Classic"),
            Q("How would you design a real-time chat system?", "Messaging"),
            Q("Design a notification system for a large-scale app.", "Distributed"),
            Q("How would you design a rate limiter?", "Infrastructure"),
            Q("Design an e-commerce checkout system.", "Transaction"),
            Q("How would you design a feed system like Twitter?", "Social"),
            Q("Design a file storage service like Dropbox.", "Storage"),
            Q("How would you design a search autocomplete system?", "Search"),
            Q("Design a metrics/monitoring system.", "Observability"),
            Q("How would you design an API gateway?", "Infrastructure"),
        ],
        InterviewType.Coding => [
            Q("How would you find duplicates in an array?", "Arrays"),
            Q("Explain your approach to reversing a linked list.", "Data Structures"),
            Q("How would you detect a cycle in a graph?", "Graphs"),
            Q("Describe your approach to solving a two-sum problem.", "Arrays"),
            Q("How would you implement an LRU cache?", "Design"),
            Q("Explain your approach to binary search and its variants.", "Search"),
            Q("How would you merge two sorted arrays?", "Arrays"),
            Q("Describe how you'd validate a binary search tree.", "Trees"),
            Q("How would you find the shortest path in a weighted graph?", "Graphs"),
            Q("Explain dynamic programming with a real example.", "DP"),
        ],
        InterviewType.Final => [
            Q("Where do you see yourself in five years?", "Vision"),
            Q("What would your first 90 days look like in this role?", "Planning"),
            Q("How do you handle disagreements with your manager?", "Leadership"),
            Q("What's the most impactful thing you've built?", "Impact"),
            Q("Why should we hire you over other candidates?", "Pitch"),
            Q("How do you prioritize when everything is urgent?", "Judgment"),
            Q("Tell me about a time you drove a major decision.", "Leadership"),
            Q("What questions do you have about the team?", "Closing"),
            Q("How do you stay current with technology?", "Growth"),
            Q("What kind of manager brings out your best work?", "Culture"),
        ],
        _ => [],
    };

    static PracticeQuestion Q(string text, string category) =>
        new() { Text = text, Category = category };
}
